declare module 'automerge' {
  // Public API (Automerge.*)

  /**
   * Creates an empty document object with no changes.
   *
   * @param {string|object} [options] if a string is passed, it is treated as `actorId`
   *
   * @returns an empty Automerge document
   *
   * @example const doc = Automerge.init()
   * @example const doc = Automerge.init('1234')
   * @example const doc = Automerge.init({actorId: '1234'})
   * @example const doc = Automerge.init({freeze: true})
   */
  function init<T>(options?: InitOptions<T>): Doc<T>

  /**
   * Returns a new document object initialized with the given state.
   *
   * @param initialState an object with the initial state for the document
   * @param [options] takes the same options as `Automerge.init`
   *
   * @returns the new Automerge document
   *
   * @example const doc = Automerge.from({ todos: [] })
   * @example const doc = Automerge.from({ todos: [] }, '1234')
   * @example const doc = Automerge.from({ todos: [] }, { actorId: '1234' })
   * @example const doc = Automerge.from({ todos: [] }, { freeze: true })
   */
  function from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): Doc<T>

  function clone<T>(doc: Doc<T>, options?: InitOptions<T>): Doc<T>
  function free<T>(doc: Doc<T>): void

  function merge<T>(localdoc: Doc<T>, remotedoc: Doc<T>): Doc<T>

  /**
   * Changes a document `doc` according to actions taken by the local user. The actual change is made
   * within the callback function `callback`, which is passed a mutable version of the document.
   *
   * @param doc the Automerge document to modify
   * @param options if a string is passed, it is treated as `message`
   * @param callback the change function
   *
   * @example
   * const v1 = Automerge.init()
   * const v2 = Automerge.change(v1, doc => doc.todos = [])
   * const v3 = Automerge.change(v2, doc => doc.todos.push('feed the hamsters'))
   */
  function change<D, T = Proxy<D>>(doc: D, options: ChangeOptions<T>, callback: ChangeFn<T>): D
  function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): D

  /**
   * Triggers a new change request on the document `doc` without actually modifying its data. Can be
   * useful for acknowledging the receipt of some message (as it's incorported into the `deps` field
   * of the change).
   * @param {*} doc the Automerge document
   * @param {string|object} options same as `change` options
   * @returns the original document
   */
  function emptyChange<D extends Doc<any>>(doc: D, options?: ChangeOptions<D>): D

  function applyChanges<T>(doc: Doc<T>, changes: BinaryChange[]): [Doc<T>, Patch]
  function equals<T>(val1: T, val2: T): boolean
  function encodeChange(change: Change): BinaryChange
  function decodeChange(binaryChange: BinaryChange): Change

  // exposed directly from Frontend:
  function getActorId<T>(doc: Doc<T>): string
  function getConflicts<T>(doc: Doc<T>, key: keyof T): any
  function getLastLocalChange<T>(doc: Doc<T>): BinaryDocument
  function getObjectById<T>(doc: Doc<T>, objectId: OpId): any
  function getObjectId(object: any): OpId
  function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>

  function getAllChanges<T>(doc: Doc<T>): BinaryChange[]
  function getChanges<T>(olddoc: Doc<T>, newdoc: Doc<T>): BinaryChange[]
  function getHistory<D, T = Proxy<D>>(doc: Doc<T>): State<T>[]

  function load<T>(data: BinaryDocument, options?: any): Doc<T>
  function save<T>(doc: Doc<T>): BinaryDocument

  /**
   * Given a backend and what we believe to be the state of our peer, generate a message which tells
   * them about we have and includes any changes we believe they need
   */
  function generateSyncMessage<T>(
    /** our latest version of the doc */
    doc: Doc<T>,

    /** our sync state for this peer */
    syncState: SyncState
  ): [
    /** updated sync state for this peer */
    SyncState,

    /** sync message to send to the peer (or `null` if there are no changes) */
    BinarySyncMessage | null
  ]

  /**
   * Given a backend, a sync message and the state of our peer, apply any changes, update what
   * we believe about the peer, and (if there were applied changes) produce a patch for the frontend
   */
  function receiveSyncMessage<T>(
    /** our latest version of the doc */
    doc: Doc<T>,

    /** our sync state for this peer */
    syncState: SyncState,

    /** the sync message we received from the peer */
    message: BinarySyncMessage
  ): [
    /** the updated document */
    Doc<T>,

    /** updated sync state for this peer */
    SyncState,

    /* if changes were applied, a patch for the frontend; otherwise `null`  */
    Patch | null
  ]

  /** Creates an empty SyncState object. */
  function initSyncState(): SyncState

  // custom CRDT types

  class Table<T> {
    constructor()
    add(item: T): UUID
    byId(id: UUID): T & TableRow
    count: number
    ids: UUID[]
    remove(id: UUID): void
    rows: (T & TableRow)[]
  }
  type ReadonlyTable<T> = ReadonlyArray<T> & Table<T>

  class TableRow {
    readonly id: UUID
  }

  class List<T> extends Array<T> {
    insertAt?(index: number, ...args: T[]): List<T>
    deleteAt?(index: number, numDelete?: number): List<T>
  }
  type ReadonlyList<T> = ReadonlyArray<T> & List<T>

  class Text extends List<string> {
    constructor(text?: string | string[])
    get(index: number): string
    toSpans<T>(): (string | T)[]
  }
  type ReadonlyText = ReadonlyList<string> & Text

  /**
   * Note: until https://github.com/Microsoft/TypeScript/issues/2361 is addressed, we
   * can't treat a Counter like a literal number without force-casting it as a number.
   * This won't compile:
   * ```
   * assert.strictEqual(c + 10, 13) // ❌
   * // Error: Operator '+' cannot be applied to types 'Counter' and '10'.ts(2365)
   * ```
   * But this will:
   * ```
   * assert.strictEqual(c as unknown as number + 10, 13) // ✅
   * ```
   */

  /**
   *
   */
  class Counter extends Number {
    constructor(value?: number)
    increment(delta?: number): void
    decrement(delta?: number): void
    toString(): string
    valueOf(): number
    value: number
  }

  // Front & back

  namespace Frontend {
    function applyPatch<T>(doc: Doc<T>, patch: Patch, backendState?: BackendState): Doc<T>
    function change<D, T = Proxy<D>>(doc: D, message: string | undefined, callback: ChangeFn<T>): [D, Change]
    function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): [D, Change]
    function emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
    function from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): [Doc<T>, Change]
    function getActorId<T>(doc: Doc<T>): string
    function getBackendState<T>(doc: Doc<T>): BackendState
    function getConflicts<T>(doc: Doc<T>, key: keyof T): any
    function getElementIds(list: any): string[]
    function getLastLocalChange<T>(doc: Doc<T>): BinaryChange
    function getObjectById<T>(doc: Doc<T>, objectId: OpId): Doc<T>
    function getObjectId<T>(doc: Doc<T>): OpId
    function init<T>(options?: InitOptions<T>): Doc<T>
    function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
  }

  namespace Backend {
    function applyChanges(state: BackendState, changes: BinaryChange[]): [BackendState, Patch]
    function applyLocalChange(state: BackendState, change: Change): [BackendState, Patch, BinaryChange]
    function clone(state: BackendState): BackendState
    function free(state: BackendState): void
    function getAllChanges(state: BackendState): BinaryChange[]
    function getChangeByHash(state: BackendState, hash: Hash): BinaryChange
    function getChanges(state: BackendState, haveDeps: Hash[]): BinaryChange[]
    function getHeads(state: BackendState): Hash[]
    function getMissingDeps(state: BackendState, heads?: Hash[]): Hash[]
    function getPatch(state: BackendState): Patch
    function init(): BackendState
    function load(data: BinaryDocument): BackendState
    function loadChanges(state: BackendState, changes: BinaryChange[]): BackendState
    function save(state: BackendState): BinaryDocument
    function generateSyncMessage(state: BackendState, syncState: SyncState): [SyncState, BinarySyncMessage?]
    function receiveSyncMessage(state: BackendState, syncState: SyncState, message: BinarySyncMessage): [BackendState, SyncState, Patch?]
    function encodeSyncMessage(message: SyncMessage): BinarySyncMessage
    function decodeSyncMessage(bytes: BinarySyncMessage): SyncMessage
    function initSyncState(): SyncState
    function encodeSyncState(syncState: SyncState): BinarySyncState
    function decodeSyncState(bytes: BinarySyncState): SyncState
  }

  // Types

  /**
   * The return type of `Automerge.init<T>()`, `Automerge.change<T>()`, etc. where `T` is the
   * original type. It is a recursively frozen version of the original type.
   */
  type Doc<T> = FreezeObject<T>

  /**
   * The argument pased to the callback of a `change` function is a mutable proxy of the original
   * type. `Proxy<D>` is the inverse of `Doc<T>`: `Proxy<Doc<T>>` is `T`, and `Doc<Proxy<D>>` is `D`.
   */
  type Proxy<D> = D extends Doc<infer T> ? T : never

  /**
   * A change function is a callback that receives a mutable version of an Automerge document. Any
   * changes made to this mutable version are made on the actual document.
   */
  type ChangeFn<T> = (doc: T) => void

  type InitOptions<T> =
    | string // = actorId
    | {
        actorId?: string
        deferActorId?: boolean
        freeze?: boolean
        observable?: Observable
        patchCallback?: PatchCallback<T>
      }

  type ChangeOptions<T> =
    | string // = message
    | {
        /** an optional descriptive string that is attached to the change (analogous to a git commit message) */
        message?: string

        // Q: is this a unix timestamp?
        time?: number

        /** a callback to be executed when the change is complete */
        patchCallback?: PatchCallback<T>
      }

  type PatchCallback<T> = (
    patch: Patch,
    before: T,
    after: T,
    local: boolean,
    changes: BinaryChange[]
  ) => void

  type ObserverCallback<T> = (
    diff: MapDiff | ListDiff | ValueDiff,
    before: T,
    after: T,
    local: boolean,
    changes: BinaryChange[]
  ) => void

  class Observable {
    observe<T>(object: T, callback: ObserverCallback<T>): void
  }

  type Hash = string // 64-digit hex string
  type OpId = string // of the form `${counter}@${actorId}`

  type UUID = string
  type UUIDGenerator = () => UUID
  interface UUIDFactory extends UUIDGenerator {
    setFactory: (generator: UUIDGenerator) => void
    reset: () => void
  }
  const uuid: UUIDFactory

  interface Clock {
    [actorId: string]: number
  }

  interface State<T> {
    change: Change
    snapshot: T
  }

  interface BackendState {
    // no public methods or properties
  }

  type BinaryChange = Uint8Array & { __binaryChange: true }
  type BinaryDocument = Uint8Array & { __binaryDocument: true }
  type BinarySyncState = Uint8Array & { __binarySyncState: true }
  type BinarySyncMessage = Uint8Array & { __binarySyncMessage: true }

  interface SyncState {
    // no public methods or properties
  }

  interface SyncMessage {
    heads: Hash[]
    need: Hash[]
    have: SyncHave[]
    changes: BinaryChange[]
  }

  interface SyncHave {
    lastSync: Hash[]
    bloom: Uint8Array
  }

  interface Change {
    message: string
    actor: string
    time: number
    seq: number
    deps: Hash[]
    ops: Op[]
  }

  interface Op {
    action: OpAction
    obj: OpId
    key: string | number
    insert: boolean
    child?: OpId
    value?: number | boolean | string | null
    datatype?: DataType
    pred?: OpId[]
    values?: (number | boolean | string | null)[]
    multiOp?: number
  }

  interface Patch {
    actor?: string
    seq?: number
    pendingChanges: number
    clock: Clock
    deps: Hash[]
    diffs: MapDiff
  }

  // Describes changes to a map (in which case propName represents a key in the
  // map) or a table object (in which case propName is the primary key of a row).
  interface MapDiff {
    objectId: OpId        // ID of object being updated
    type: 'map' | 'table' // type of object being updated
    // For each key/property that is changing, props contains one entry
    // (properties that are not changing are not listed). The nested object is
    // empty if the property is being deleted, contains one opId if it is set to
    // a single value, and contains multiple opIds if there is a conflict.
    props: {[propName: string]: {[opId: string]: MapDiff | ListDiff | ValueDiff }}
  }

  // Describes changes to a list or Automerge.Text object, in which each element
  // is identified by its index.
  interface ListDiff {
    objectId: OpId        // ID of object being updated
    type: 'list' | 'text' // type of objct being updated
    // This array contains edits in the order they should be applied.
    edits: (SingleInsertEdit | MultiInsertEdit | UpdateEdit | RemoveEdit)[]
  }

  // Describes the insertion of a single element into a list or text object.
  // The element can be a nested object.
  interface SingleInsertEdit {
    action: 'insert'
    index: number   // the list index at which to insert the new element
    elemId: OpId    // the unique element ID of the new list element
    opId: OpId      // ID of the operation that assigned this value
    value: MapDiff | ListDiff | ValueDiff
  }

  // Describes the insertion of a consecutive sequence of primitive values into
  // a list or text object. In the case of text, the values are strings (each
  // character as a separate string value). Each inserted value is given a
  // consecutive element ID: starting with `elemId` for the first value, the
  // subsequent values are given elemIds with the same actor ID and incrementing
  // counters. To insert non-primitive values, use SingleInsertEdit.
  interface MultiInsertEdit {
    action: 'multi-insert'
    index: number   // the list index at which to insert the first value
    elemId: OpId    // the unique ID of the first inserted element
    values: (number | boolean | string | null)[] // list of values to insert
  }

  // Describes the update of the value or nested object at a particular index
  // of a list or text object. In the case where there are multiple conflicted
  // values at the same list index, multiple UpdateEdits with the same index
  // (but different opIds) appear in the edits array of ListDiff.
  interface UpdateEdit {
    action: 'update'
    index: number   // the list index to update
    opId: OpId      // ID of the operation that assigned this value
    value: MapDiff | ListDiff | ValueDiff
  }

  // Describes the deletion of one or more consecutive elements from a list or
  // text object.
  interface RemoveEdit {
    action: 'remove'
    index: number   // index of the first list element to remove
    count: number   // number of list elements to remove
  }

  // Describes a primitive value, optionally tagged with a datatype that
  // indicates how the value should be interpreted.
  interface ValueDiff {
    type: 'value'
    value: number | boolean | string | null
    datatype?: DataType
  }

  type OpAction =
    | 'del'
    | 'inc'
    | 'set'
    | 'link'
    | 'makeText'
    | 'makeTable'
    | 'makeList'
    | 'makeMap'

  type CollectionType =
    | 'list' //..
    | 'map'
    | 'table'
    | 'text'

  type DataType =
    | 'counter' //..
    | 'timestamp'

  // TYPE UTILITY FUNCTIONS

  // Type utility function: Freeze
  // Generates a readonly version of a given object, array, or map type applied recursively to the nested members of the root type.
  // It's like TypeScript's `readonly`, but goes all the way down a tree.

  // prettier-ignore
  type Freeze<T> =
    T extends Function ? T
    : T extends Text ? ReadonlyText
    : T extends Table<infer T> ? FreezeTable<T>
    : T extends List<infer T> ? FreezeList<T>
    : T extends Array<infer T> ? FreezeArray<T>
    : T extends Map<infer K, infer V> ? FreezeMap<K, V>
    : T extends string & infer O ? string & O
    : FreezeObject<T>

  interface FreezeTable<T> extends ReadonlyTable<Freeze<T>> {}
  interface FreezeList<T> extends ReadonlyList<Freeze<T>> {}
  interface FreezeArray<T> extends ReadonlyArray<Freeze<T>> {}
  interface FreezeMap<K, V> extends ReadonlyMap<Freeze<K>, Freeze<V>> {}
  type FreezeObject<T> = { readonly [P in keyof T]: Freeze<T[P]> }
}
