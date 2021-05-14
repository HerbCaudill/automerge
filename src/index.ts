// TODO this is really clumsy but is just temporary
import { IBackend, IFrontend } from './types'
import * as _Backend from '../backend'
import * as _Frontend from '../frontend'
export const Backend = _Backend as unknown as IBackend
export const Frontend = _Frontend as unknown as IFrontend

export * from './automerge'
export * from './types'