const assert = require('assert')
const Automerge = require('../src/automerge')
const Backend = require('../backend')
const uuid = require('../src/uuid')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

describe('Backend', () => {
  describe('incremental diffs', () => {
    it('should assign to a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[actor]: {value: 'magpie'}}
        }}
      })
    })

    it('should increment a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counter: {[actor]: {value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should make a conflict on assignment to the same key', () => {
      const change1 = {actor: 'actor1', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {actor1: 1, actor2: 1}, deps: {actor1: 1, actor2: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {actor1: {value: 'magpie'}, actor2: {value: 'blackbird'}}
        }}
      })
    })

    it('should delete a key from a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del', obj: ROOT_ID, key: 'bird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {bird: {}}}
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {wrens: {[actor]: {value: 3}}}
        }}}}
      })
    })

    it('should assign to keys in nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {sparrows: {[actor]: {value: 15}}}
        }}}}
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds',      child: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', maxElem: 1,
          edits: [{action: 'insert', index: 0, elemId: `${actor}:1`}],
          props: {0: {[actor]: {value: 'chaffinch'}}}
        }}}}
      })
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds',      child: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'greenfinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', edits: [],
          props: {0: {[actor]: {value: 'greenfinch'}}}
        }}}}
      })
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds',      child: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',      obj: birds,   key: `${actor}:1`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', props: {},
          edits: [{action: 'remove', index: 0, elemId: `${actor}:1`}]
        }}}}
      })
    })

    it('should handle list element insertion and deletion in the same change', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'ins', obj: birds, key: '_head', elem: 1},
        {action: 'del', obj: birds, key: `${actor}:1`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', maxElem: 1, edits: [], props: {}
        }}}}
      })
    })

    it('should handle changes within conflicted objects', () => {
      const list = uuid(), map = uuid(), actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'conflict', child: list}
      ]}
      const change2 = {actor: actor2, seq: 1, deps: {}, ops: [
        {action: 'makeMap',  obj: ROOT_ID, key: 'conflict', child: map}
      ]}
      const change3 = {actor: actor2, seq: 2, deps: {}, ops: [
        {action: 'set', obj: map, key: 'sparrows', value: 12}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      const [s3, patch3] = Backend.applyChanges(s2, [change3])
      assert.deepEqual(patch3, {
        canUndo: false, canRedo: false,
        clock: {[actor1]: 1, [actor2]: 2}, deps: {[actor1]: 1, [actor2]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {conflict: {
          [actor1]: {objectId: list, type: 'list'},
          [actor2]: {objectId: map, type: 'map', props: {sparrows: {[actor2]: {value: 12}}}}
        }}}
      })
    })

    it('should support Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          now: {[actor]: {value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should support Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'list',       child: list},
        {action: 'ins',      obj: list,    key: '_head',      elem: 1},
        {action: 'set',      obj: list,    key: `${actor}:1`, value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {list: {[actor]: {
          objectId: list, type: 'list', maxElem: 1,
          edits: [{action: 'insert', index: 0, elemId: `${actor}:1`}],
          props: {0: {[actor]: {value: now.getTime(), datatype: 'timestamp'}}}
        }}}}
      })
    })
  })

  describe('applyLocalChange()', () => {
    it('should apply change requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      assert.deepEqual(patch1, {
        actor, seq: 1, canUndo: true, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[actor]: {value: 'magpie'}}
        }}
      })
    })

    it('should throw an exception on duplicate requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'jay'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.throws(() => Backend.applyLocalChange(s2, change1), /Change request has already been applied/)
      assert.throws(() => Backend.applyLocalChange(s2, change2), /Change request has already been applied/)
    })
  })

  describe('getPatch()', () => {
    it('should include the most recent value for a key', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[actor]: {value: 'blackbird'}}
        }}
      })
    })

    it('should include conflicting values for a key', () => {
      const change1 = {actor: 'actor1', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {actor1: 1, actor2: 1}, deps: {actor1: 1, actor2: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {actor1: {value: 'magpie'}, actor2: {value: 'blackbird'}}
        }}
      })
    })

    it('should handle counter increments at a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counter: {[actor]: {value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',     obj: birds,   key: 'wrens'},
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {sparrows: {[actor]: {value: 15}}}
        }}}}
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds',      child: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', maxElem: 1,
          edits: [{action: 'insert', index: 0, elemId: `${actor}:1`}],
          props: {0: {[actor]: {value: 'chaffinch'}}}
        }}}}
      })
    })

    it('should include the latest state of a list', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds',      child: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'ins',      obj: birds,   key: `${actor}:1`, elem: 2},
        {action: 'set',      obj: birds,   key: `${actor}:2`, value: 'goldfinch'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',      obj: birds,   key: `${actor}:1`},
        {action: 'ins',      obj: birds,   key: `${actor}:1`, elem: 3},
        {action: 'set',      obj: birds,   key: `${actor}:3`, value: 'greenfinch'},
        {action: 'set',      obj: birds,   key: `${actor}:2`, value: 'goldfinches!!'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', maxElem: 3,
          edits: [
            {action: 'insert', index: 0, elemId: `${actor}:3`},
            {action: 'insert', index: 1, elemId: `${actor}:2`}
          ],
          props: {0: {[actor]: {value: 'greenfinch'}}, 1: {[actor]: {value: 'goldfinches!!'}}}
        }}}}
      })
    })

    it('should handle nested maps in lists', () => {
      const todos = uuid(), item = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'todos',     child: todos},
        {action: 'ins',      obj: todos,   key: '_head',     elem: 1},
        {action: 'makeMap',  obj: todos,   key:`${actor}:1`, child: item},
        {action: 'set',      obj: item,    key: 'title',     value: 'water plants'},
        {action: 'set',      obj: item,    key: 'done',      value: false}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {todos: {[actor]: {
          objectId: todos, type: 'list', maxElem: 1,
          edits: [{action: 'insert', index: 0, elemId: `${actor}:1`}],
          props: {0: {[actor]: {
            objectId: item, type: 'map', props: {
              title: {[actor]: {value: 'water plants'}},
              done:  {[actor]: {value: false}}
            }
          }}}
        }}}}
      })
    })

    it('should include Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          now: {[actor]: {value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should include Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'list',       child: list},
        {action: 'ins',      obj: list,    key: '_head',      elem: 1},
        {action: 'set',      obj: list,    key: `${actor}:1`, value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: {objectId: ROOT_ID, type: 'map', props: {list: {[actor]: {
          objectId: list, type: 'list', maxElem: 1,
          edits: [{action: 'insert', index: 0, elemId: `${actor}:1`}],
          props: {0: {[actor]: {value: now.getTime(), datatype: 'timestamp'}}}
        }}}}
      })
    })
  })

  describe('getChangesForActor()', () => {
    let oneDoc, twoDoc, mergeDoc

    beforeEach(() => {
      oneDoc = Automerge.change(Automerge.init('actor1'), doc => doc.document = 'watch me now')
      twoDoc = Automerge.init('actor2')
      twoDoc = Automerge.change(twoDoc, doc => doc.document = 'i can mash potato')
      twoDoc = Automerge.change(twoDoc, doc => doc.document = 'i can do the twist')
      mergeDoc = Automerge.merge(oneDoc, twoDoc)
    })

    it('should get changes for a single actor', () => {
      const state = Automerge.Frontend.getBackendState(mergeDoc)
      const actorChanges = Backend.getChangesForActor(state, 'actor2')

      assert.equal(actorChanges.length, 2)
      assert.equal(actorChanges[0].actor, 'actor2')
    })
  })
})
