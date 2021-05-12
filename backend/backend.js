const { Map, List } = require('immutable')
const OpSet = require('./op_set')
const { splitContainers, encodeChange, decodeChanges, encodeDocument, constructPatch, BackendDoc } = require('./columnar')
const { backendState } = require('./util')

// Feature flag: false uses old Immutable.js-based backend data structures, true uses new
// byte-array-based data structures. New data structures are not yet fully working.
const USE_NEW_BACKEND = false

function numHashesByActor(state, actorId) {
  if (USE_NEW_BACKEND) {
    return (state.hashesByActor[actorId] || []).length
  } else {
    return state.getIn(['opSet', 'states', actorId], List()).size
  }
}

function hashByActor(state, actorId, index) {
  if (USE_NEW_BACKEND) {
    return (state.hashesByActor[actorId] || [])[index]
  } else {
    return state.getIn(['opSet', 'states', actorId, index])
  }
}

/**
 * Returns an empty node state.
 */
function init() {
  if (USE_NEW_BACKEND) {
    return {state: new BackendDoc(), heads: []}
  } else {
    return {state: Map({opSet: OpSet.init(), objectIds: Map()}), heads: []}
  }
}

function clone(backend) {
  if (USE_NEW_BACKEND) {
    return {state: backendState(backend).clone(), heads: backend.heads}
  } else {
    return {state: backendState(backend), heads: backend.heads}
  }
}

function free(backend) {
  backend.state = null
  backend.frozen = true
}

/**
 * Constructs a patch object from the current node state `state` and the
 * object modifications `diffs`.
 */
function makePatch(state, diffs, request, isIncremental) {
  const clock = state.getIn(['opSet', 'states']).map(seqs => seqs.size).toJSON()
  const deps  = state.getIn(['opSet', 'deps']).toJSON().sort()
  const maxOp = state.getIn(['opSet', 'maxOp'], 0)
  const pendingChanges = OpSet.getMissingDeps(state.get('opSet')).length
  const patch = {clock, deps, diffs, maxOp, pendingChanges}

  if (isIncremental && request) {
    patch.actor = request.actor
    patch.seq   = request.seq

    // Omit the local actor's own last change from deps
    const lastHash = state.getIn(['opSet', 'states', request.actor, request.seq - 1])
    patch.deps = patch.deps.filter(dep => dep !== lastHash)
  }
  return patch
}

/**
 * The implementation behind `applyChanges()`, `applyLocalChange()`, and
 * `loadChanges()`.
 */
function apply(state, changes, request, isIncremental) {

  // isIncremental=false indicates that we're making changes in bulk (e.g. via Automerge.load())
  // isIncremental=true is the case when applying individual changes from the application or from a peer

  let diffs = isIncremental ? {objectId: '_root', type: 'map', props: {}} : null
  let opSet = state.get('opSet')
  for (let change of changes) {
    for (let chunk of splitContainers(change)) {
      if (request) {
        // this is a new change by the application
        opSet = OpSet.addLocalChange(opSet, chunk, diffs)
      } else {
        // this is an existing change coming from storage or from a peer
        opSet = OpSet.addChange(opSet, chunk, diffs)
      }
    }
  }

  OpSet.finalizePatch(diffs)
  state = state.set('opSet', opSet)

  return [state, isIncremental ? makePatch(state, diffs, request, true) : null]
}

/**
 * Applies a list of `changes` from remote nodes to the node state `backend`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(backend, changes) {
  if (USE_NEW_BACKEND) {
    const state = backendState(backend)
    const patch = state.applyChanges(changes)
    backend.frozen = true
    return [{state, heads: state.heads}, patch]
  } else {
    let [state, patch] = apply(backendState(backend), changes, null, true)
    const heads = OpSet.getHeads(state.get('opSet'))
    backend.frozen = true
    return [{state, heads}, patch]
  }
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `backend`. Returns a three-element array `[backend, patch, binaryChange]`
 * where `backend` is the updated node state,`patch` confirms the
 * modifications to the document objects, and `binaryChange` is a binary-encoded form of
 * the change submitted.
 */
function applyLocalChange(backend, change) {
  const state = backendState(backend)
  if (change.seq <= numHashesByActor(state, change.actor)) {
    throw new RangeError('Change request has already been applied')
  }

  // Add the local actor's last change hash to deps. We do this because when frontend
  // and backend are on separate threads, the frontend may fire off several local
  // changes in sequence before getting a response from the backend; since the binary
  // encoding and hashing is done by the backend, the frontend does not know the hash
  // of its own last change in this case. Rather than handle this situation as a
  // special case, we say that the frontend includes only specifies other actors'
  // deps in changes it generates, and the dependency from the local actor's last
  // change is always added here in the backend.
  //
  // Strictly speaking, we should check whether the local actor's last change is
  // indirectly reachable through a different actor's change; in that case, it is not
  // necessary to add this dependency. However, it doesn't do any harm either (only
  // using a few extra bytes of storage).
  if (change.seq > 1) {
    const lastHash = hashByActor(state, change.actor, change.seq - 2)
    if (!lastHash) {
      throw new RangeError(`Cannot find hash of localChange before seq=${change.seq}`)
    }
    let deps = {[lastHash]: true}
    for (let hash of change.deps) deps[hash] = true
    change.deps = Object.keys(deps).sort()
  }

  const binaryChange = encodeChange(change)

  if (USE_NEW_BACKEND) {
    const patch = state.applyChanges([binaryChange], true)
    backend.frozen = true

    // On the patch we send out, omit the last local change hash
    const lastHash = hashByActor(state, change.actor, change.seq - 1)
    patch.deps = patch.deps.filter(head => head !== lastHash)
    return [{state, heads: state.heads}, patch, binaryChange]

  } else {
    const request = {actor: change.actor, seq: change.seq}
    const [state2, patch] = apply(state, [binaryChange], request, true)
    const heads = OpSet.getHeads(state2.get('opSet'))
    backend.frozen = true
    return [{state: state2, heads}, patch, binaryChange]
  }
}

/**
 * Returns the state of the document serialised to an Uint8Array.
 */
function save(backend) {
  if (USE_NEW_BACKEND) {
    return backendState(backend).save()
  } else {
    return encodeDocument(getAllChanges(backend))
  }
}

/**
 * Loads the document and/or changes contained in an Uint8Array, and returns a
 * backend initialised with this state.
 */
function load(data) {
  if (USE_NEW_BACKEND) {
    const state = new BackendDoc(data)
    return {state, heads: state.heads}
  } else {
    // Reconstruct the original change history that created the document.
    // It's a bit silly to convert to and from the binary encoding several times...!
    const binaryChanges = decodeChanges([data]).map(encodeChange)
    return loadChanges(init(), binaryChanges)
  }
}

/**
 * Applies a list of `changes` to the node state `backend`, and returns the updated
 * state with those changes incorporated. Unlike `applyChanges()`, this function
 * does not produce a patch describing the incremental modifications, making it
 * a little faster when loading a document from disk. When all the changes have
 * been loaded, you can use `getPatch()` to construct the latest document state.
 */
function loadChanges(backend, changes) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    state.applyChanges(changes)
    backend.frozen = true
    return {state, heads: state.heads}
  } else {
    const [newState] = apply(state, changes, null, false)
    backend.frozen = true
    return {state: newState, heads: OpSet.getHeads(newState.get('opSet'))}
  }
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `backend`.
 */
function getPatch(backend) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    const diffs = constructPatch(state.save())
    return {
      maxOp: state.maxOp,
      clock: state.clock,
      deps: state.heads,
      diffs
    }
  } else {
    const diffs = constructPatch(save(backend))
    return makePatch(state, diffs, null, false)
  }
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(backend) {
  return backend.heads
}

/**
 * Returns the full history of changes that have been applied to a document.
 */
function getAllChanges(backend) {
  return getChanges(backend, [])
}

/**
 * Returns all changes that are newer than or concurrent to the changes
 * identified by the hashes in `haveDeps`. If `haveDeps` is an empty array, all
 * changes are returned. Throws an exception if any of the given hashes is unknown.
 */
function getChanges(backend, haveDeps) {
  if (!Array.isArray(haveDeps)) {
    throw new TypeError('Pass an array of hashes to Backend.getChanges()')
  }

  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChanges(haveDeps)
  } else {
    return OpSet.getMissingChanges(state.get('opSet'), List(haveDeps))
  }
}

/**
 * If the backend has applied a change with the given `hash` (given as a
 * hexadecimal string), returns that change (as a byte array). Returns undefined
 * if no change with that hash has been applied. A change with missing
 * dependencies does not count as having been applied.
 */
function getChangeByHash(backend, hash) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChangeByHash(hash)
  } else {
    return OpSet.getChangeByHash(state.get('opSet'), hash)
  }
}

/**
 * Returns the hashes of any missing dependencies, i.e. where we have applied a
 * change that has a dependency on a change we have not seen.
 *
 * If the argument `heads` is given (an array of hexadecimal strings representing
 * hashes as returned by `getHeads()`), this function also ensures that all of
 * those hashes resolve to either a change that has been applied to the document,
 * or that has been enqueued for later application once missing dependencies have
 * arrived. Any missing heads hashes are included in the returned array.
 */
function getMissingDeps(backend, heads = []) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getMissingDeps(heads)
  } else {
    return OpSet.getMissingDeps(state.get('opSet'), heads)
  }
}

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getHeads, getAllChanges, getChanges, getChangeByHash, getMissingDeps
}
