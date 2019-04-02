const { ROOT_ID } = require('../src/common')
const { OBJECT_ID, CHANGE, STATE } = require('./constants')
const { Text } = require('./text')
const { Table } = require('./table')

function parseListIndex(key) {
  if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key)
  if (typeof key !== 'number') {
    throw new TypeError('A list index must be a number, but you passed ' + JSON.stringify(key))
  }
  if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity) {
    throw new RangeError('A list index must be positive, but you passed ' + key)
  }
  return key
}

function listMethods(context, listId, path) {
  const methods = {
    deleteAt(index, numDelete) {
      context.splice(path, listId, parseListIndex(index), numDelete || 1, [])
      return this
    },

    fill(value, start, end) {
      let list = context.getObject(listId)
      for (let index = parseListIndex(start || 0); index < parseListIndex(end || list.length); index++) {
        context.setListIndex(path, listId, index, value)
      }
      return this
    },

    insertAt(index, ...values) {
      context.splice(path, listId, parseListIndex(index), 0, values)
      return this
    },

    pop() {
      let list = context.getObject(listId)
      if (list.length == 0) return
      const last = context.getObjectField(path, listId, list.length - 1)
      context.splice(path, listId, list.length - 1, 1, [])
      return last
    },

    push(...values) {
      let list = context.getObject(listId)
      context.splice(path, listId, list.length, 0, values)
      // need to getObject() again because the list object above may be immutable
      return context.getObject(listId).length
    },

    shift() {
      let list = context.getObject(listId)
      if (list.length == 0) return
      const first = context.getObjectField(path, listId, 0)
      context.splice(path, listId, 0, 1, [])
      return first
    },

    splice(start, deleteCount, ...values) {
      let list = context.getObject(listId)
      start = parseListIndex(start)
      if (deleteCount === undefined) {
        deleteCount = list.length - start
      }
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(context.getObjectField(path, listId, start + n))
      }
      context.splice(path, listId, start, deleteCount, values)
      return deleted
    },

    unshift(...values) {
      context.splice(path, listId, 0, 0, values)
      return context.getObject(listId).length
    }
  }

  for (let iterator of ['entries', 'keys', 'values']) {
    let list = context.getObject(listId)
    methods[iterator] = () => list[iterator]()
  }

  // Read-only methods that can delegate to the JavaScript built-in implementations
  for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                      'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                      'slice', 'some', 'toLocaleString', 'toString']) {
    methods[method] = (...args) => {
      const list = context.getObject(listId)
      return list[method].call(list, ...args)
    }
  }

  return methods
}

const MapHandler = {
  get (target, key) {
    const { context, objectId, path } = target
    if (key === OBJECT_ID) return objectId
    if (key === CHANGE) return context
    if (key === STATE) return {actorId: context.actorId}
    return context.getObjectField(path, objectId, key)
  },

  set (target, key, value) {
    const { context, objectId, path } = target
    context.setMapKey(path, objectId, 'map', key, value)
    return true
  },

  deleteProperty (target, key) {
    const { context, objectId, path } = target
    context.deleteMapKey(path, objectId, key)
    return true
  },

  has (target, key) {
    const { context, objectId } = target
    return [OBJECT_ID, CHANGE].includes(key) || (key in context.getObject(objectId))
  },

  getOwnPropertyDescriptor (target, key) {
    const { context, objectId } = target
    const object = context.getObject(objectId)
    if (key in object) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    const { context, objectId } = target
    return Object.keys(context.getObject(objectId))
  }
}

const ListHandler = {
  get (target, key) {
    const [context, objectId, path] = target
    if (key === Symbol.iterator) return context.getObject(objectId)[Symbol.iterator]
    if (key === OBJECT_ID) return objectId
    if (key === CHANGE) return context
    if (key === 'length') return context.getObject(objectId).length
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return context.getObjectField(path, objectId, parseListIndex(key))
    }
    return listMethods(context, objectId, path)[key]
  },

  set (target, key, value) {
    const [context, objectId, path] = target
    context.setListIndex(path, objectId, parseListIndex(key), value)
    return true
  },

  deleteProperty (target, key) {
    const [context, objectId, path] = target
    context.splice(path, objectId, parseListIndex(key), 1, [])
    return true
  },

  has (target, key) {
    const [context, objectId, path] = target
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseListIndex(key) < context.getObject(objectId).length
    }
    return ['length', OBJECT_ID, CHANGE].includes(key)
  },

  getOwnPropertyDescriptor (target, key) {
    if (key === 'length') return {}
    if (key === OBJECT_ID) return {configurable: false, enumerable: false}

    const [context, objectId, path] = target
    const object = context.getObject(objectId)

    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      const index = parseListIndex(key)
      if (index < object.length) return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    const [context, objectId, path] = target
    const object = context.getObject(objectId)
    let keys = ['length']
    keys.push(...Object.keys(object))
    return keys
  }
}

function mapProxy(context, objectId, path) {
  return new Proxy({context, objectId, path}, MapHandler)
}

function listProxy(context, objectId, path) {
  return new Proxy([context, objectId, path], ListHandler)
}

/**
 * Instantiates a proxy object for the given `objectId`.
 * This function is added as a method to the context object by rootObjectProxy().
 * When it is called, `this` is the context object.
 */
function instantiateProxy(path, objectId) {
  const object = this.getObject(objectId)
  if (Array.isArray(object) || (object instanceof Text)) {
    return listProxy(this, objectId, path)
  } else if (object instanceof Table) {
    return object.getWriteable(this, path)
  } else {
    return mapProxy(this, objectId, path)
  }
}

function rootObjectProxy(context) {
  context.instantiateObject = instantiateProxy
  return mapProxy(context, ROOT_ID, [])
}

module.exports = { rootObjectProxy }
