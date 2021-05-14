import { Table, Text, Counter, WriteableCounter } from '.'

/**
 * The return type of `Automerge.init<T>()`, `Automerge.change<T>()`, etc. where `T` is the
 * original type. It is a recursively frozen version of the original type.
 */
export type Doc<T> = FreezeObject<T>

/**
 * The argument pased to the callback of a `change` function is a mutable proxy of the original
 * type. `Proxy<D>` is the inverse of `Doc<T>`: `Proxy<Doc<T>>` is `T`, and `Doc<Proxy<D>>` is `D`.
 */
export type Proxy<D> = D extends Doc<infer T> ? T : never

export type ChangeFn<T> = (doc: Proxy<T>) => void

// Automerge.* functions

export type InitOptions<T> =
  | string // = actorId
  | {
      actorId?: string
      deferActorId?: boolean
      freeze?: boolean
      patchCallback?: PatchCallback<T>
      observable?: Observable
    }

export type ChangeOptions<T> =
  | string // = message
  | {
      message?: string
      time?: number
      patchCallback?: PatchCallback<T>
    }

export type PatchCallback<T> = (patch: Patch, before: T, after: T, local: boolean, changes: BinaryChange[]) => void
export type ObserverCallback<T> = (
  diff: MapDiff | ListDiff | ValueDiff,
  before: T,
  after: T,
  local: boolean,
  changes: BinaryChange[]
) => void

class Observable {
  // observe<T>(object: T, callback: ObserverCallback<T>): void
}


// custom CRDT types

export interface TableRow {
  readonly id: UUID
}

export interface List<T> extends Array<T> {
  insertAt?(index: number, ...args: T[]): List<T>
  deleteAt?(index: number, numDelete?: number): List<T>
}




// Readonly variants

export type ReadonlyTable<T> = ReadonlyArray<T> & Table<T>
export type ReadonlyList<T> = ReadonlyArray<T> & List<T>
export type ReadonlyText = ReadonlyList<string> & Text

// Front & back

export interface IFrontend {
  applyPatch<T>(doc: Doc<T>, patch: Patch, backendState?: BackendState): Doc<T>
  change<D>(doc: D, message: string | undefined, callback: ChangeFn<D>): [D, Change]
  change<D>(doc: D, callback: ChangeFn<D>): [D, Change]
  emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
  from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): [Doc<T>, Change]
  getActorId<T>(doc: Doc<T>): string
  getBackendState<T>(doc: Doc<T>): BackendState
  getConflicts<T>(doc: Doc<T>, key: keyof T): any
  getElementIds(list: any): string[]
  getLastLocalChange<T>(doc: Doc<T>): BinaryChange
  getObjectById<T>(doc: Doc<T>, objectId: OpId): Doc<T>
  getObjectId<T>(doc: Doc<T>): OpId
  init<T = AnyDoc>(options?: InitOptions<T>): Doc<T>
  setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
}

export interface IBackend {
  applyChanges(state: BackendState, changes: BinaryChange[]): [BackendState, Patch]
  applyLocalChange(state: BackendState, change: Change): [BackendState, Patch, BinaryChange]
  clone(state: BackendState): BackendState
  free(state: BackendState): void
  getAllChanges(state: BackendState): BinaryChange[]
  getChangeByHash(state: BackendState, hash: Hash): BinaryChange
  getChanges(state: BackendState, haveDeps: Hash[]): BinaryChange[]
  getHeads(state: BackendState): Hash[]
  getMissingDeps(state: BackendState, heads?: Hash[]): Hash[]
  getPatch(state: BackendState): Patch
  init(): BackendState
  load(data: BinaryDocument): BackendState
  loadChanges(state: BackendState, changes: BinaryChange[]): BackendState
  save(state: BackendState): BinaryDocument
  generateSyncMessage(state: BackendState, syncState: SyncState): [SyncState, BinarySyncMessage?]
  receiveSyncMessage(state: BackendState, syncState: SyncState, message: BinarySyncMessage): [BackendState, SyncState, Patch?]
  encodeSyncMessage(message: SyncMessage): BinarySyncMessage
  decodeSyncMessage(bytes: BinarySyncMessage): SyncMessage
  initSyncState(): SyncState
  encodeSyncState(syncState: SyncState): BinarySyncState
  decodeSyncState(bytes: BinarySyncState): SyncState
}

// Internals

export type Hash = string // 64-digit hex string
export type OpId = string // of the form `${counter}@${actorId}`

export type UUID = string
export type UUIDGenerator = () => UUID
export interface UUIDFactory extends UUIDGenerator {
  setFactory: (generator: UUIDGenerator) => void
  reset: () => void
}
// const uuid: UUIDFactory

export interface Clock {
  [actorId: string]: number
}

export interface State<T> {
  readonly change: Change
  readonly snapshot: T
}

export interface BackendState {
  // no public methods or properties
}

// nominal types for binary data structures

export type BinaryChange = Nominal<Uint8Array, 'BinaryChange'>
export type BinaryDocument = Nominal<Uint8Array, 'BinaryDocument'>
export type BinarySyncState = Nominal<Uint8Array, 'BinarySyncState'>
export type BinarySyncMessage = Nominal<Uint8Array, 'BinarySyncMessage'>

export interface SyncState {
  // no public methods or properties
}

export interface SyncMessage {
  heads: Hash[]
  need: Hash[]
  have: SyncHave[]
  changes: BinaryChange[]
}

export interface SyncHave {
  lastSync: Hash[]
  bloom: Uint8Array
}

export interface Change {
  message: string
  actor: string
  time: number
  seq: number
  deps: Hash[]
  ops: Op[]
}

export interface Op {
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

export interface Patch {
  actor?: string
  seq?: number
  pendingChanges: number
  clock: Clock
  deps: Hash[]
  diffs: MapDiff
}

// Describes changes to a map (in which case propName represents a key in the
// map) or a table object (in which case propName is the primary key of a row).
export interface MapDiff {
  objectId: OpId // ID of object being updated
  type: 'map' | 'table' // type of object being updated
  // For each key/property that is changing, props contains one entry
  // (properties that are not changing are not listed). The nested object is
  // empty if the property is being deleted, contains one opId if it is set to
  // a single value, and contains multiple opIds if there is a conflict.
  props: { [propName: string]: { [opId: string]: MapDiff | ListDiff | ValueDiff } }
}

// Describes changes to a list or Automerge.Text object, in which each element
// is identified by its index.
export interface ListDiff {
  objectId: OpId // ID of object being updated
  type: 'list' | 'text' // type of objct being updated
  // This array contains edits in the order they should be applied.
  edits: (SingleInsertEdit | MultiInsertEdit | UpdateEdit | RemoveEdit)[]
}

// Describes the insertion of a single element into a list or text object.
// The element can be a nested object.
export interface SingleInsertEdit {
  action: 'insert'
  index: number // the list index at which to insert the new element
  elemId: OpId // the unique element ID of the new list element
  opId: OpId // ID of the operation that assigned this value
  value: MapDiff | ListDiff | ValueDiff
}

// Describes the insertion of a consecutive sequence of primitive values into
// a list or text object. In the case of text, the values are strings (each
// character as a separate string value). Each inserted value is given a
// consecutive element ID: starting with `elemId` for the first value, the
// subsequent values are given elemIds with the same actor ID and incrementing
// counters. To insert non-primitive values, use SingleInsertEdit.
export interface MultiInsertEdit {
  action: 'multi-insert'
  index: number // the list index at which to insert the first value
  elemId: OpId // the unique ID of the first inserted element
  values: (number | boolean | string | null)[] // list of values to insert
}

// Describes the update of the value or nested object at a particular index
// of a list or text object. In the case where there are multiple conflicted
// values at the same list index, multiple UpdateEdits with the same index
// (but different opIds) appear in the edits array of ListDiff.
export interface UpdateEdit {
  action: 'update'
  index: number // the list index to update
  opId: OpId // ID of the operation that assigned this value
  value: MapDiff | ListDiff | ValueDiff
}

// Describes the deletion of one or more consecutive elements from a list or
// text object.
export interface RemoveEdit {
  action: 'remove'
  index: number // index of the first list element to remove
  count: number // number of list elements to remove
}

// Describes a primitive value, optionally tagged with a datatype that
// indicates how the value should be interpreted.
export interface ValueDiff {
  type: 'value'
  value: number | boolean | string | null
  datatype?: DataType
}

export type OpAction = 'del' | 'inc' | 'set' | 'link' | 'makeText' | 'makeTable' | 'makeList' | 'makeMap'

export type CollectionType =
  | 'list' //..
  | 'map'
  | 'table'
  | 'text'

export type DataType =
  | 'counter' //..
  | 'timestamp'

// TYPE UTILITY FUNCTIONS

// Type utility function: Freeze
// Generates a readonly version of a given object, array, or map type applied recursively to the nested members of the root type.
// It's like TypeScript's `readonly`, but goes all the way down a tree.

// prettier-ignore
export type Freeze<T> =
      T extends Function ? T
    : T extends WriteableCounter ? FreezeCounter
    : T extends Counter ? FreezeCounter
    : T extends Text ? FreezeText
    : T extends Table<infer T> ? FreezeTable<T>
    : T extends List<infer T> ? FreezeList<T>
    : T extends Array<infer T> ? FreezeList<T>
    : T extends Map<infer K, infer V> ? FreezeMap<K, V>
    : T extends string & infer O ? string & O
    : FreezeObject<T>

export type AnyDoc = Record <string | number | symbol, any>
  
export interface FreezeCounter extends Counter {}
export interface FreezeText extends ReadonlyText {}
export interface FreezeTable<T> extends ReadonlyTable<Freeze<T>> {}
export interface FreezeList<T> extends ReadonlyList<Freeze<T>> {}
export interface FreezeArray<T> extends ReadonlyArray<Freeze<T>> {}
export interface FreezeMap<K, V> extends ReadonlyMap<Freeze<K>, Freeze<V>> {}
export type FreezeObject<T> = { readonly [P in keyof T]: Freeze<T[P]> }


// Helpers for nominal types
// https://github.com/andnp/SimplyTyped/blob/master/src/types/utils.ts#L30-L41

export declare class Tagged<N extends string> {
  protected _nominal_: N
}
export type Nominal<T, N extends string> = T & Tagged<N>
