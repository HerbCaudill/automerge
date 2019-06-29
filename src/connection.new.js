const { Map, fromJS } = require('immutable')
const { lessOrEqual } = require('./common')
const Frontend = require('../frontend')
const Backend = require('../backend')

// Keeps track of the communication with one particular peer. Allows updates for many documents to
// be multiplexed over a single connection.
//
// To integrate a connection with a particular networking stack, two functions are used:
// * `sendMsg` (callback passed to the constructor, will be called when local state is updated)
//   takes a message as argument, and sends it out to the remote peer.
// * `receiveMsg` (method on the connection object) should be called by the network stack when a
//   message is received from the remote peer.
//
// The documents to be synced are managed by a `DocSet`. Whenever a document is changed locally,
// call `setDoc()` on the docSet. The connection registers a callback on the docSet, and it figures
// out whenever there are changes that need to be sent to the remote peer.
//
// "`theirClock"` is the most recent VCl ock that we think the peer has (either because they've told us
// that it's their clock, or because it corresponds to a state we have sent to them on this
// connection). Thus, everything more recent than theirClock should be sent to the peer.
//
// `ourClock` is the most recent VClock that we've advertised to the peer (i.e. where we've
// told the peer that we have it).
class ConnectionNew {
  constructor(docSet, sendMsg) {
    this.docSet = docSet
    this.sendMsg = sendMsg
    this.ourClockMap = Map()
    this.theirClockMap = Map()
    this.clockMap = { ours: this.ourClockMap, theirs: this.theirClockMap }
  }

  // Public API

  open() {
    // Process initial state of each existing doc
    for (let docId of this.docSet.docIds) this._registerDoc(docId, this.docSet.getDoc(docId))

    // Subscribe to docSet changes
    this.docSet.registerHandler(this._docChanged.bind(this))
  }

  close() {
    // Unsubscribe from docSet changes
    this.docSet.unregisterHandler(this._docChanged.bind(this))
  }

  // Called by the network stack whenever it receives a message from a peer
  receiveMsg({ docId, clock, changes }) {
    // Record their clock value for this document
    if (clock) this._updateClock(theirs, docId, clock)

    const weHaveDoc = this._state(docId) !== undefined

    // If they sent changes, apply them to our document
    if (changes) return this.docSet.applyChanges(docId, fromJS(changes))
    // If they didn't send changes and we have the document, treat it as a request for our latest changes
    else if (weHaveDoc) this._maybeSendChanges(docId)
    // If they didn't send changes and we don't have the document, treat it as an advertisement and request the document
    else return this.requestDoc(docId)
  }

  // Private methods

  _registerDoc(docId, doc) {
    // Record the doc's initial clock
    this._updateClock(ours, docId)
    // Advertise the document
    this._requestChanges(docId)
  }

  // Callback that is called by the docSet whenever a document is changed
  _docChanged(docId, doc) {
    const ourClock = this._getClock(docId, ours)
    const clock = this._getClock(docId)

    // Make sure doc has a clock (i.e. is an automerge object)
    if (!clock) throw new TypeError(ERR_NOCLOCK)

    // Make sure the document is newer than what we already have
    if (!lessOrEqual(ourClock, clock)) throw new RangeError(ERR_OLDCLOCK)

    this._maybeSendChanges(docId)
    this._maybeRequestChanges(docId)
    this._updateClock(ours, docId)
  }

  // Send changes if we have more recent information than they do
  _maybeSendChanges(docId) {
    const theirClock = this._getClock(docId, theirs)
    if (!theirClock) return

    const clock = this._getClock(docId)

    // If we have changes they don't have, send them
    const changes = Backend.getMissingChanges(this._state(docId), theirClock)
    if (changes.length > 0) this._sendChanges(docId, changes)
  }

  _sendChanges(docId, changes) {
    const clock = this._getClock(docId)
    this.sendMsg({ docId, clock: clock.toJS(), changes })
    this._updateClock([ours, theirs], docId)
  }

  // Request changes if we're out of date (?)
  _maybeRequestChanges(docId) {
    const clock = this._getClock(docId)
    const ourClock = this._getClock(docId, ours)
    // If the document is newer than what we have, request changes
    if (!lessOrEqual(clock, ourClock)) this._requestChanges(docId)
  }

  // A message with no changes is a request for changes
  _requestChanges(docId, clock = this._getClock(docId) || {}) {
    this.sendMsg({ docId, clock: clock.toJS() })
  }

  // A message with a docId and an empty clock is a request for a document
  requestDoc(docId) {
    this.sendMsg({ docId, clock: {} })
  }

  // Updates the vector clock for `docId` in the given `clockMap` (mapping from docId to vector clock) by merging in
  // the new vector clock `clock`, setting each node's sequence number has been set to the maximum for that node.
  _updateClock(which, docId, clock = this._getClock(docId)) {
    clock = fromJS(clock)
    if (!Array.isArray(which)) which = [which]
    which.forEach(which => {
      const clockMap = this.clockMap[which]
      const oldClock = clockMap.get(docId, Map())
      // Merge the clocks, keeping the maximum sequence number for each node
      const newClock = oldClock.mergeWith(largestWinsStrategy, clock)
      // Update the clockMap
      this.clockMap[which] = clockMap.set(docId, newClock)
    })
  }

  _state(docId) {
    const doc = this.docSet.getDoc(docId)
    if (doc) return Frontend.getBackendState(doc)
  }

  _getClock(docId, which) {
    if (which) {
      const initialClockValue = which === ours ? Map() : undefined
      return this.clockMap[which].get(docId, initialClockValue)
    } else {
      return this._state(docId).getIn(['opSet', 'clock'])
    }
  }
}

const largestWinsStrategy = (x, y) => Math.max(x, y)

const ERR_OLDCLOCK = 'Cannot pass an old state object to a connection'
const ERR_NOCLOCK =
  'This object cannot be used for network sync. ' +
  'Are you trying to sync a snapshot from the history?'

const ours = 'ours'
const theirs = 'theirs'

module.exports = ConnectionNew
