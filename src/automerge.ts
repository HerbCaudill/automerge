import { Doc, InitOptions } from "./types"

import uuid from './uuid'
import Frontend from '../frontend'
import { OPTIONS } from '../frontend/constants'
import { encodeChange, decodeChange } from '../backend/columnar'
import { isObject } from './common'
import _backend from '../backend' 

let backend = _backend // mutable: can be overridden with setDefaultBackend()

/**
 * Automerge.* API
 * The functions in this file constitute the publicly facing Automerge API which combines
 * the features of the Frontend (a document interface) and the backend (CRDT operations)
 */

export function init<T>(options?: InitOptions<T>): Doc<T> {
  if (typeof options === 'string') {
    options = {actorId: options}
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported options for init(): ${options}`)
  }
  return Frontend.init(Object.assign({backend}, options)) as Doc<T>
}

/**
 * Returns a new document object initialized with the given state.
 */
function from(initialState, options) {
  const changeOpts = {message: 'Initialization'}
  return change(init(options), changeOpts, doc => Object.assign(doc, initialState))
}

function change(doc, options, callback) {
  const [newDoc] = Frontend.change(doc, options, callback)
  return newDoc
}

function emptyChange(doc, options) {
  const [newDoc] = Frontend.emptyChange(doc, options)
  return newDoc
}

function clone(doc, options = {}) {
  const state = backend.clone(Frontend.getBackendState(doc))
  return applyPatch(init(options), backend.getPatch(state), state, [], options)
}

function free(doc) {
  backend.free(Frontend.getBackendState(doc))
}

function load(data, options = {}) {
  const state = backend.load(data)
  return applyPatch(init(options), backend.getPatch(state), state, [data], options)
}

function save(doc) {
  return backend.save(Frontend.getBackendState(doc))
}

function merge(localDoc, remoteDoc) {
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  // Just copy all changes from the remote doc; any duplicates will be ignored
  const [updatedDoc] = applyChanges(localDoc, getAllChanges(remoteDoc))
  return updatedDoc
}

function getChanges(oldDoc, newDoc) {
  const oldState = Frontend.getBackendState(oldDoc)
  const newState = Frontend.getBackendState(newDoc)
  return backend.getChanges(newState, backend.getHeads(oldState))
}

function getAllChanges(doc) {
  return backend.getAllChanges(Frontend.getBackendState(doc))
}

function applyPatch(doc, patch, backendState, changes, options) {
  const newDoc = Frontend.applyPatch(doc, patch, backendState)
  const patchCallback = options.patchCallback || doc[OPTIONS].patchCallback
  if (patchCallback) {
    patchCallback(patch, doc, newDoc, false, changes)
  }
  return newDoc
}

function applyChanges(doc, changes, options = {}) {
  const oldState = Frontend.getBackendState(doc)
  const [newState, patch] = backend.applyChanges(oldState, changes)
  return [applyPatch(doc, patch, newState, changes, options), patch]
}

function equals(val1, val2) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function getHistory(doc) {
  const actor = Frontend.getActorId(doc)
  const history = getAllChanges(doc)
  return history.map((change, index) => ({
      get change () {
        return decodeChange(change)
      },
      get snapshot () {
        const state = backend.loadChanges(backend.init(), history.slice(0, index + 1))
        return Frontend.applyPatch(init(actor), backend.getPatch(state), state)
      }
    })
  )
}

function generateSyncMessage(doc, syncState) {
  return backend.generateSyncMessage(Frontend.getBackendState(doc), syncState)
}

function receiveSyncMessage(doc, oldSyncState, message) {
  const [backendState, syncState, patch] = backend.receiveSyncMessage(Frontend.getBackendState(doc), oldSyncState, message)
  if (!patch) return [doc, syncState, patch]

  // The patchCallback is passed as argument all changes that are applied.
  // We get those from the sync message if a patchCallback is present.
  let changes = null
  if (doc[OPTIONS].patchCallback) {
    changes = backend.decodeSyncMessage(message).changes
  }
  return [applyPatch(doc, patch, backendState, changes, {}), syncState, patch]
}

function initSyncState() {
  return backend.initSyncState()
}

/**
 * Replaces the default backend implementation with a different one.
 * This allows you to switch to using the Rust/WebAssembly implementation.
 */
function setDefaultBackend(newBackend) {
  backend = newBackend
}

// module.exports = {
//   from, change, emptyChange, clone, free,
//   load, save, merge, getChanges, getAllChanges, applyChanges,
//   encodeChange, decodeChange, equals, getHistory, uuid,
//   Frontend, setDefaultBackend, generateSyncMessage, receiveSyncMessage, initSyncState,
//   get Backend() { return backend }
// }

// for (let name of ['getObjectId', 'getObjectById', 'getActorId',
//      'setActorId', 'getConflicts', 'getLastLocalChange',
//      'Text', 'Table', 'Counter', 'Observable']) {
//   module.exports[name] = Frontend[name]
// }
