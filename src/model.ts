// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  IIterator,
  IterableOrArrayLike,
  iter,
  map,
  toArray
} from '@lumino/algorithm';

import { JSONExt } from '@lumino/coreutils';

import { StringExt } from '@lumino/algorithm';

import { ISignal, Signal } from '@lumino/signaling';

import { Completer } from './widget';

/**
 * An implementation of a completer model.
 */
export class CompleterModel implements Completer.IModel {
  /**
   * A signal emitted when state of the completer menu changes.
   */
  get stateChanged(): ISignal<this, void> {
    return this._stateChanged;
  }

  /**
   * The original completion request details.
   */
  get original(): Completer.ITextState | null {
    return this._original;
  }
  set original(newValue: Completer.ITextState | null) {
    let unchanged =
      this._original === newValue ||
      (this._original &&
        newValue &&
        JSONExt.deepEqual(newValue, this._original));
    if (unchanged) {
      return;
    }

    this._reset();

    // Set both the current and original to the same value when original is set.
    this._current = this._original = newValue;

    this._stateChanged.emit(undefined);
  }

  /**
   * The current text change details.
   */
  get current(): Completer.ITextState | null {
    return this._current;
  }
  set current(newValue: Completer.ITextState | null) {
    const unchanged =
      this._current === newValue ||
      (this._current && newValue && JSONExt.deepEqual(newValue, this._current));

    if (unchanged) {
      return;
    }

    const original = this._original;

    // Original request must always be set before a text change. If it isn't
    // the model fails silently.
    if (!original) {
      return;
    }

    const cursor = this._cursor;

    // Cursor must always be set before a text change. This happens
    // automatically in the completer handler, but since `current` is a public
    // attribute, this defensive check is necessary.
    if (!cursor) {
      return;
    }

    const current = (this._current = newValue);

    if (!current) {
      this._stateChanged.emit(undefined);
      return;
    }

    const originalLine = original.text.split('\n')[original.line];
    const currentLine = current.text.split('\n')[current.line];

    // If the text change means that the original start point has been preceded,
    // then the completion is no longer valid and should be reset.
    if (!this._subsetMatch && currentLine.length < originalLine.length) {
      this.reset(true);
      return;
    }

    const { start, end } = cursor;
    // Clip the front of the current line.
    let query = current.text.substring(start);
    // Clip the back of the current line by calculating the end of the original.
    const ending = original.text.substring(end);
    query = query.substring(0, query.lastIndexOf(ending));
    this._query = query;
    this._stateChanged.emit(undefined);
  }

  /**
   * The cursor details that the API has used to return matching options.
   */
  get cursor(): Completer.ICursorSpan | null {
    return this._cursor;
  }
  set cursor(newValue: Completer.ICursorSpan | null) {
    // Original request must always be set before a cursor change. If it isn't
    // the model fails silently.
    if (!this.original) {
      return;
    }
    this._cursor = newValue;
  }

  /**
   * The query against which items are filtered.
   */
  get query(): string {
    return this._query;
  }
  set query(newValue: string) {
    this._query = newValue;
  }

  /**
   * A flag that is true when the model value was modified by a subset match.
   */
  get subsetMatch(): boolean {
    return this._subsetMatch;
  }
  set subsetMatch(newValue: boolean) {
    this._subsetMatch = newValue;
  }

  /**
   * Get whether the model is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the resources held by the model.
   */
  dispose(): void {
    // Do nothing if already disposed.
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    Signal.clearData(this);
  }

  /**
   * The list of visible items in the completer menu.
   *
   * #### Notes
   * This is a read-only property.
   */
  items(): IIterator<Completer.IItem> {
    return this._filter();
  }

  /**
   * The unfiltered list of all available options in a completer menu.
   */
  options(): IIterator<string> {
    return iter(this._options);
  }

  /**
   * The map from identifiers (a.b) to types (function, module, class, instance,
   * etc.).
   *
   * #### Notes
   * A type map is currently only provided by the latest IPython kernel using
   * the completer reply metadata field `_jupyter_types_experimental`. The
   * values are completely up to the kernel.
   *
   */
  typeMap(): Completer.TypeMap {
    return this._typeMap;
  }

  /**
   * An ordered list of all the known types in the typeMap.
   *
   * #### Notes
   * To visually encode the types of the completer matches, we assemble an
   * ordered list. This list begins with:
   * ```
   * ['function', 'instance', 'class', 'module', 'keyword']
   * ```
   * and then has any remaining types listed alphebetically. This will give
   * reliable visual encoding for these known types, but allow kernels to
   * provide new types.
   */
  orderedTypes(): string[] {
    return this._orderedTypes;
  }

  /**
   * Set the available options in the completer menu.
   */
  setOptions(
    query: string,
    newValue: IterableOrArrayLike<string>,
    typeMap?: Completer.TypeMap,
    replaceMap?: Completer.ReplaceMap,
    languageMap?: Completer.LanguageMap,
    sortByMap?: Completer.SortByMap,
  ) {
    const values = toArray(newValue || []);
    const types = typeMap || {};
    const replaces = replaceMap || {};
    const languages = languageMap || {};
    const sortBy = sortByMap || {};

    if (
      JSONExt.deepEqual(values, this._options) &&
      JSONExt.deepEqual(types, this._typeMap) &&
      JSONExt.deepEqual(replaces, this._replaceMap) && 
      JSONExt.deepEqual(languages, this._languageMap) && 
      JSONExt.deepEqual(sortBy, this._sortByMap)
    ) {
      return;
    }
    if (values.length) {
      this._query = query;
      this._options = values;
      this._typeMap = types;
      this._replaceMap = replaces;
      this._languageMap = languages;
      this._sortByMap = sortBy;
      this._orderedTypes = Private.findOrderedTypes(types);
    } else {
      this._query = query;
      this._options = [];
      this._typeMap = {};
      this._replaceMap = {};
      this._languageMap = {};
      this._sortByMap = {};
      this._orderedTypes = [];
    }
    this._stateChanged.emit(undefined);
  }

  /**
   * Handle a cursor change.
   */
  handleCursorChange(change: Completer.ITextState): void {
    // If there is no active completion, return.
    if (!this._original) {
      return;
    }

    const { column, line } = change;
    const { current, original } = this;

    if (!original) {
      return;
    }

    // If a cursor change results in a the cursor being on a different line
    // than the original request, cancel.
    if (line !== original.line) {
      this.reset(true);
      return;
    }

    // If a cursor change results in the cursor being set to a position that
    // precedes the original column, cancel.
    if (column < original.column) {
      this.reset(true);
      return;
    }

    const { cursor } = this;

    if (!cursor || !current) {
      return;
    }

    // If a cursor change results in the cursor being set to a position beyond
    // the end of the area that would be affected by completion, cancel.
    const cursorDelta = cursor.end - cursor.start;
    const originalLine = original.text.split('\n')[original.line];
    const currentLine = current.text.split('\n')[current.line];
    const inputDelta = currentLine.length - originalLine.length;

    if (column > original.column + cursorDelta + inputDelta) {
      this.reset(true);
      return;
    }
  }

  /**
   * Handle a text change.
   */
  handleTextChange(change: Completer.ITextState): void {
    const original = this._original;

    // If there is no active completion, return.
    if (!original) {
      return;
    }

    const { text, column, line } = change;
    const last = text.split('\n')[line][column - 1];

    // If last character entered is not whitespace or if the change column is
    // greater than or equal to the original column, update completion.
    if ((last && last.match(/\S/)) || change.column >= original.column) {
      this.current = change;
      return;
    }

    // If final character is whitespace, reset completion.
    this.reset(false);
  }

  /**
   * Create a resolved patch between the original state and a patch string.
   *
   * @param patch - The patch string to apply to the original value.
   *
   * @returns A patched text change or undefined if original value did not exist.
   */
  createPatch(patch: string): Completer.IPatch | undefined {
    const original = this._original;
    const cursor = this._cursor;
    const current = this._current;

    if (!original || !cursor || !current) {
      return undefined;
    }

    let { start, end } = cursor;
    // Also include any filtering/additional-typing that has occurred
    // since the completion request in the patched length.
    end = end + (current.text.length - original.text.length);

    return { start, end, value: patch };
  }

  /**
   * Reset the state of the model and emit a state change signal.
   *
   * @param hard - Reset even if a subset match is in progress.
   */
  reset(hard = false) {
    // When the completer detects a common subset prefix for all options,
    // it updates the model and sets the model source to that value, triggering
    // a reset. Unless explicitly a hard reset, this should be ignored.
    if (!hard && this._subsetMatch) {
      return;
    }
    this._reset();
    this._stateChanged.emit(undefined);
  }

  /**
   * Apply the query to the complete options list to return the matching subset.
   */
  private _filter(): IIterator<Completer.IItem> {
    let options = this._options || [];
    let query = this._query;
    if (!query) {
      return map(options, option => (
        { 
          raw: option, 
          text: option, 
          replaceText: this._replaceMap[option] || option,
          language: this._languageMap[option] || "javascript",
          sortBy: this._sortByMap[option] || option
        }
      ));
    }
    let results: Private.IMatch[] = [];
    for (let option of options) {
      let match = StringExt.matchSumOfSquares(option, query);
      if (match) {
        let marked = StringExt.highlight(option, match.indices, Private.mark);
        results.push({
          raw: option,
          score: match.score,
          text: marked.join(''),
          replaceText: this._replaceMap[option] || option,
          language: this._languageMap[option] || "javascript",
          sortBy: this._sortByMap[option] || option,
        });
      }
    }
    return map(results.sort(Private.scoreCmp), result => ({
      text: result.text,
      raw: result.raw,
      replaceText: result.replaceText,
      language: result.language
    }));
  }

  /**
   * Reset the state of the model.
   */
  private _reset(): void {
    this._current = null;
    this._cursor = null;
    this._options = [];
    this._original = null;
    this._query = '';
    this._subsetMatch = false;
    this._typeMap = {};
    this._replaceMap = {};
    this._languageMap = {};
    this._sortByMap = {};
    this._orderedTypes = [];
  }

  private _current: Completer.ITextState | null = null;
  private _cursor: Completer.ICursorSpan | null = null;
  private _isDisposed = false;
  private _options: string[] = [];
  private _original: Completer.ITextState | null = null;
  private _query = '';
  private _subsetMatch = false;
  private _typeMap: Completer.TypeMap = {};
  private _replaceMap: Completer.ReplaceMap = {};
  private _languageMap: Completer.LanguageMap = {};
  private _sortByMap: Completer.SortByMap = {};
  private _orderedTypes: string[] = [];
  private _stateChanged = new Signal<this, void>(this);
}

/**
 * A namespace for completer model private data.
 */
namespace Private {
  /**
   * The list of known type annotations of completer matches.
   */
  const KNOWN_TYPES = ['function', 'instance', 'class', 'module', 'keyword', 'extract', 'transform', 'load', 'execute', 'validate'];

  /**
   * The map of known type annotations of completer matches.
   */
  const KNOWN_MAP = KNOWN_TYPES.reduce((acc, type) => {
    acc[type] = null;
    return acc;
  }, {} as Completer.TypeMap);

  /**
   * A filtered completion menu matching result.
   */
  export interface IMatch {
    /**
     * The raw text of a completion match.
     */
    raw: string;

    /**
     * A score which indicates the strength of the match.
     *
     * A lower score is better. Zero is the best possible score.
     */
    score: number;

    /**
     * The highlighted text of a completion match.
     */
    text: string;

    /**
     * The replace text of a completion match.
     */
    replaceText: string;

    /**
     * The language for codemirror of the completion match.
     */
    language: string;

    /**
     * The custom sort field for codemirror of the completion match.
     */
    sortBy: string;    
  }

  /**
   * Mark a highlighted chunk of text.
   */
  export function mark(value: string): string {
    return `<mark>${value}</mark>`;
  }

  /**
   * A sort comparison function for item match scores.
   *
   * #### Notes
   * This orders the items first based on score (lower is better), then
   * by locale order of the item text.
   */
  export function scoreCmp(a: IMatch, b: IMatch): number {
    let delta = a.score - b.score;
    if (delta !== 0) {
      return delta;
    }
    return a.sortBy.localeCompare(b.sortBy);
  }

  /**
   * Compute a reliably ordered list of types.
   *
   * #### Notes
   * The resulting list always begins with the known types:
   * ```
   * ['function', 'instance', 'class', 'module', 'keyword']
   * ```
   * followed by other types in alphabetical order.
   */
  export function findOrderedTypes(typeMap: Completer.TypeMap): string[] {
    const filtered = Object.keys(typeMap)
      .map(key => typeMap[key])
      .filter(
        (value: string | null): value is string =>
          !!value && !(value in KNOWN_MAP)
      )
      .sort((a, b) => a.localeCompare(b));

    return KNOWN_TYPES.concat(filtered);
  }
}
