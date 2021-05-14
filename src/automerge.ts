import { Backend as _Backend } from '.'
import { decodeChange } from '../backend/columnar'
import { OPTIONS } from '../frontend/constants'
import { isObject } from './common'
import {
  IBackend,
  BackendState,
  BinaryChange,
  BinaryDocument,
  BinarySyncMessage,
  Change,
  ChangeFn,
  ChangeOptions,
  Doc,
  InitOptions,
  Patch,
  Proxy,
  State,
  SyncState,
  AnyDoc,
} from './types'

export {
  Counter,
  WriteableCounter,
  getActorId,
  getConflicts,
  getLastLocalChange,
  getObjectById,
  getObjectId,
  Observable,
  setActorId,
  Table,
  Text,
} from '../frontend'

export { decodeChange } from '../backend/columnar'

import Frontend from '../frontend'

// TODO there has to be a better way
import _uuid from './uuid'
export const uuid = _uuid

export let backend = _Backend
export let Backend = _Backend

/**
 * Automerge.* API
 * The functions in this file constitute the publicly facing Automerge API which combines
 * the features of the Frontend (a document interface) and the backend (CRDT operations)
 */

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
export function init<T = AnyDoc>(options?: InitOptions<T>): Doc<T> {
  if (typeof options === 'string') {
    options = { actorId: options }
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported options for init(): ${options}`)
  }
  return Frontend.init(Object.assign({ backend }, options)) as Doc<T>
}

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
export function from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): Doc<T> {
  const changeOpts = { message: 'Initialization' }
  return change(init(options), changeOpts, doc => Object.assign(doc, initialState))
}

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
// overload signatures
export function change<D>(doc: D, options: ChangeOptions<D>, callback: ChangeFn<D>): D
export function change<D>(doc: D, callback: ChangeFn<D>): D
// implementation
export function change<D>(doc: D, options: ChangeOptions<D> | ChangeFn<D>, callback?: ChangeFn<D>): D {
  const [newDoc] = Frontend.change(doc, options, callback)
  return newDoc
}

/**
 * Triggers a new change request on the document `doc` without actually modifying its data. Can be
 * useful for acknowledging the receipt of some message (as it's incorported into the `deps` field
 * of the change).
 * @param {*} doc the Automerge document
 * @param {string|object} options same as `change` options
 * @returns the original document
 */
export function emptyChange<D extends Doc<any>>(doc: D, options?: ChangeOptions<D>): D {
  const [newDoc] = Frontend.emptyChange(doc, options)
  return newDoc
}

export function clone<T>(doc: Doc<T>, options?: InitOptions<T>): Doc<T> {
  const state = backend.clone(Frontend.getBackendState(doc))
  return applyPatch(init(options), backend.getPatch(state) as Patch, state, [], options)
}

export function free<T>(doc: Doc<T>): void {
  backend.free(Frontend.getBackendState(doc))
}

export function load<T>(data: BinaryDocument, options?: InitOptions<T>): Doc<T> {
  const state = backend.load(data)
  // TODO: is there a better way to do nominal typing with BinaryChange etc.
  return applyPatch(init(options), backend.getPatch(state) as Patch, state, [data as unknown as BinaryChange], options)
}

export function save<T>(doc: Doc<T>): BinaryDocument {
  return backend.save(Frontend.getBackendState(doc))
}

export function merge<T>(localDoc: Doc<T>, remoteDoc: Doc<T>): Doc<T> {
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  // Just copy all changes from the remote doc; any duplicates will be ignored
  const [updatedDoc] = applyChanges(localDoc, getAllChanges(remoteDoc))
  return updatedDoc
}

export function getChanges<T>(oldDoc: Doc<T>, newDoc: Doc<T>): BinaryChange[] {
  const oldState = Frontend.getBackendState(oldDoc)
  const newState = Frontend.getBackendState(newDoc)
  return backend.getChanges(newState, backend.getHeads(oldState))
}

export function getAllChanges<T>(doc: Doc<T>): BinaryChange[] {
  return backend.getAllChanges(Frontend.getBackendState(doc))
}

function applyPatch<T>(
  doc: Doc<T>,
  patch: Patch,
  backendState: BackendState,
  changes: BinaryChange[],
  options?: ChangeOptions<T>
) {
  const newDoc = Frontend.applyPatch(doc, patch, backendState)
  const patchCallback = (options && typeof options !== 'string' && options.patchCallback) || doc[OPTIONS].patchCallback
  if (patchCallback) {
    patchCallback(patch, doc, newDoc, false, changes)
  }
  return newDoc
}

export function applyChanges<T>(doc: Doc<T>, changes: BinaryChange[], options?: ChangeOptions<T>): [Doc<T>, Patch] {
  const oldState = Frontend.getBackendState(doc)
  const [newState, patch] = backend.applyChanges(oldState, changes)
  return [applyPatch(doc, patch, newState, changes, options), patch]
}

// ?
export function equals(val1: any, val2: any): boolean {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(),
    keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

export function getHistory<D, T = Proxy<D>>(doc: Doc<T>): State<T>[] {
  const actor = Frontend.getActorId(doc)
  const history = getAllChanges(doc)
  return history.map((change, index) => ({
    get change() {
      // TODO shouldn't need to cast as unknown once `decodeChange` is typed
      return decodeChange(change) as unknown as Change
    },
    get snapshot() {
      const state = backend.loadChanges(backend.init(), history.slice(0, index + 1))
      return Frontend.applyPatch(init(actor), backend.getPatch(state), state)
    },
  }))
}

/**
 * Given a backend and what we believe to be the state of our peer, generate a message which tells
 * them about we have and includes any changes we believe they need
 * @param doc our latest version of the doc
 * @param syncState our sync state for this peer
 * @returns A tuple containing two elements:
 * - the updated sync state for this peer
 * - a binary sync message to send to the peer (or `null` if there are no changes)
 * @example const [newSyncState, maybeSyncMessage] = Automerge.generateSyncMessage(doc, oldSyncState)
 */
export function generateSyncMessage<T>(doc: Doc<T>, syncState: SyncState) {
  return backend.generateSyncMessage(Frontend.getBackendState(doc), syncState) as [SyncState, BinarySyncMessage | null]
}

/**
 * Given a backend, a sync message and the state of our peer, apply any changes, update what
 * we believe about the peer, and (if there were applied changes) produce a patch for the frontend
 * @param doc our latest version of the doc
 * @param oldSyncState our sync state for this peer
 * @param message the binary sync message we received from the peer
 * @returns A tuple containing three elements:
 * - the updated document
 * - updated sync state for this peer
 * - if changes were applied, a patch for the frontend; otherwise `null`
 */
export function receiveSyncMessage<T>(
  doc: Doc<T>,
  oldSyncState: SyncState,
  message: BinarySyncMessage
): [Doc<T>, SyncState, Patch | null] {
  const [backendState, syncState, patch] = backend.receiveSyncMessage(
    Frontend.getBackendState(doc),
    oldSyncState,
    message
  )
  if (!patch) return [doc, syncState, patch]

  // The patchCallback is passed as argument all changes that are applied.
  // We get those from the sync message if a patchCallback is present.
  let changes = null
  if (doc[OPTIONS].patchCallback) {
    changes = backend.decodeSyncMessage(message).changes
  }
  return [applyPatch(doc, patch, backendState, changes, {}), syncState, patch]
}

/** Creates an empty SyncState object. */
export function initSyncState(): SyncState {
  return backend.initSyncState()
}

/**
 * Replaces the default backend implementation with a different one.
 * This allows you to switch to using the Rust/WebAssembly implementation.
 */
export function setDefaultBackend(newBackend: IBackend) {
  // TODO
  backend = newBackend
  Backend = newBackend
}
