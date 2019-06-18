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
// `theirClock` is the most recent VClock that we think the peer has (either because they've told us
// that it's their clock, or because it corresponds to a state we have sent to them on this
// connection). Thus, everything more recent than theirClock should be sent to the peer.
//
// `ourClock` is the most recent VClock that we've advertised to the peer (i.e. where we've
// told the peer that we have it).
class Connection {
  constructor(docSet, sendMsg) {
    this.docSet = docSet
    this.sendMsg = sendMsg
    this.clockMap = { [OURS]: Map(), [THEIRS]: Map() }
  }

  open() {
    // Process initial state of each existing doc
    for (let docId of this.docSet.docIds)
      this.registerDoc(docId, this.docSet.getDoc(docId))

    // Subscribe to docSet changes
    this.docSet.registerHandler(this.docChanged.bind(this))
  }

  close() {
    // Unsubscribe from docSet changes
    this.docSet.unregisterHandler(this.docChanged.bind(this))
  }

  registerDoc(docId, doc) {
    // Record the doc's initial clock
    this.updateClock([OURS], docId)
    // Advertise the document
    this.requestChanges(docId)
  }

  // Callback that is called by the docSet whenever a document is changed
  docChanged(docId, doc) {
    const ourClock = this.clock(docId, OURS)
    const clock = this.clock(docId)

    // Make sure doc has a clock (i.e. is an automerge object)
    if (!clock) throw new TypeError(ERR_NOCLOCK)

    // Make sure the document is newer than what we already have
    if (!lessOrEqual(ourClock, clock)) throw new RangeError(ERR_OLDCLOCK)

    this.maybeSendChanges(docId)
    this.maybeRequestChanges(docId)
    this.updateClock([OURS], docId)
  }

  // Called by the network stack whenever it receives a message from a peer
  receiveMsg({ docId, clock, changes }) {
    // Record their clock value for this document
    if (clock) this.updateClock([THEIRS], docId, clock)

    const weHaveDoc = this.state(docId) !== undefined

    // If they sent changes, apply them to our document
    if (changes) this.docSet.applyChanges(docId, fromJS(changes))
    // If they didn't send changes and we have the document, treat it as a request for our latest changes
    else if (weHaveDoc) this.maybeSendChanges(docId)
    // If they didn't send changes and we don't have the document, treat it as an advertisement and request the document
    else this.requestDoc(docId)
  }

  // Send changes if we have more recent information than they do
  maybeSendChanges(docId) {
    const theirClock = this.clock(docId, THEIRS)
    if (!theirClock) return

    const clock = this.clock(docId)

    // If we have changes they don't have, send them
    const changes = Backend.getMissingChanges(this.state(docId), theirClock)
    if (changes.length > 0) this.sendChanges(docId, changes)
  }

  sendChanges(docId, changes) {
    const clock = this.clock(docId)
    this.sendMsg({ docId, clock: clock.toJS(), changes })
    this.updateClock([OURS, THEIRS], docId)
  }

  // Request changes if we're out of date (?)
  maybeRequestChanges(docId) {
    const clock = this.clock(docId)
    const ourClock = this.clock(docId, OURS)
    // If the document is newer than what we have, request changes
    if (!lessOrEqual(clock, ourClock)) this.requestChanges(docId)
  }

  // A message with no changes is a request for changes
  requestChanges(docId, clock = this.clock(docId) || {}) {
    this.sendMsg({ docId, clock: clock.toJS() })
  }

  // A message with a docId and an empty clock is a request for a document
  requestDoc(docId) {
    this.sendMsg({ docId, clock: {} })
  }

  // Updates the vector clock for `docId` in the given `clockMap` (mapping from docId to vector clock) by merging in
  // the new vector clock `clock`, setting each node's sequence number has been set to the maximum for that node.
  updateClock(which, docId, clock = this.clock(docId)) {
    clock = fromJS(clock)
    which.forEach(which => {
      const clockMap = this.clockMap[which]
      const oldClock = clockMap.get(docId, Map())
      // Merge the clocks, keeping the maximum sequence number for each node
      const newClock = oldClock.mergeWith(largestWins, clock)
      // Update the clockMap
      this.clockMap[which] = clockMap.set(docId, newClock)
    })
  }

  state(docId) {
    const doc = this.docSet.getDoc(docId)
    if (doc) return Frontend.getBackendState(doc)
  }

  clock(docId, which) {
    if (which) {
      const defaultValue = which === OURS ? Map() : undefined
      return this.clockMap[which].get(docId, defaultValue)
    } else {
      return this.state(docId).getIn(['opSet', 'clock'])
    }
  }
}

const largestWins = (x, y) => Math.max(x, y)

const ERR_OLDCLOCK = 'Cannot pass an old state object to a connection'
const ERR_NOCLOCK =
  'This object cannot be used for network sync. ' +
  'Are you trying to sync a snapshot from the history?'

const OURS = 'ours'
const THEIRS = 'theirs'

module.exports = Connection
