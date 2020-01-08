import { isObject } from './utils'
import { Path } from '../types'

// actions
const enum Actions {
  APPEND,
  PUSH,
  INC_SUB_PATH_DEPTH,
  PUSH_SUB_PATH
}

// states
const enum States {
  BEFORE_PATH,
  IN_PATH,
  BEFORE_IDENT,
  IN_IDENT,
  IN_SUB_PATH,
  IN_SINGLE_QUOTE,
  IN_DOUBLE_QUOTE,
  AFTER_PATH,
  ERROR
}

type StateAction = [States, Actions?]

const enum PathCharTypes {
  WORKSPACE = 'w',
  IDENT = 'i',
  LEFT_BRACKET = '[',
  RIGHT_BRACKET = ']',
  DOT = '.',
  ASTARISK = '*',
  ZERO = '0',
  ELSE = 'l',
  END_OF_FAIL = 'o',
  SINGLE_QUOTE = "'",
  DOUBLE_QUOTE = '"'
}

type PathState = StateAction | States.ERROR 
type PathStateMachine = Record<string, PathState>

export const pathStateMachine = [] as PathStateMachine[]

pathStateMachine[States.BEFORE_PATH] = {
  [PathCharTypes.WORKSPACE]: [States.BEFORE_PATH],
  [PathCharTypes.IDENT]: [States.IN_IDENT, Actions.APPEND],
  [PathCharTypes.LEFT_BRACKET]: [States.IN_SUB_PATH],
  [PathCharTypes.END_OF_FAIL]: [States.AFTER_PATH]
}

pathStateMachine[States.IN_PATH] = {
  [PathCharTypes.WORKSPACE]: [States.IN_PATH],
  [PathCharTypes.DOT]: [States.BEFORE_IDENT],
  [PathCharTypes.LEFT_BRACKET]: [States.IN_SUB_PATH],
  [PathCharTypes.END_OF_FAIL]: [States.AFTER_PATH]
}

pathStateMachine[States.BEFORE_IDENT] = {
  [PathCharTypes.WORKSPACE]: [States.BEFORE_IDENT],
  [PathCharTypes.IDENT]: [States.IN_IDENT, Actions.APPEND],
  [PathCharTypes.ZERO]: [States.IN_IDENT, Actions.APPEND]
}

pathStateMachine[States.IN_IDENT] = {
  [PathCharTypes.IDENT]: [States.IN_IDENT, Actions.APPEND],
  [PathCharTypes.ZERO]: [States.IN_IDENT, Actions.APPEND],
  [PathCharTypes.WORKSPACE]: [States.IN_PATH, Actions.PUSH],
  [PathCharTypes.DOT]: [States.BEFORE_IDENT, Actions.PUSH],
  [PathCharTypes.LEFT_BRACKET]: [States.IN_SUB_PATH, Actions.PUSH],
  [PathCharTypes.END_OF_FAIL]: [States.AFTER_PATH, Actions.PUSH]
}

pathStateMachine[States.IN_SUB_PATH] = {
  [PathCharTypes.SINGLE_QUOTE]: [States.IN_SINGLE_QUOTE, Actions.APPEND],
  [PathCharTypes.DOUBLE_QUOTE]: [States.IN_DOUBLE_QUOTE, Actions.APPEND],
  [PathCharTypes.LEFT_BRACKET]: [States.IN_SUB_PATH, Actions.INC_SUB_PATH_DEPTH],
  [PathCharTypes.RIGHT_BRACKET]: [States.IN_PATH, Actions.PUSH_SUB_PATH],
  [PathCharTypes.END_OF_FAIL]: States.ERROR,
  [PathCharTypes.ELSE]: [States.IN_SUB_PATH, Actions.APPEND]
}

pathStateMachine[States.IN_SINGLE_QUOTE] = {
  [PathCharTypes.SINGLE_QUOTE]: [States.IN_SUB_PATH, Actions.APPEND],
  [PathCharTypes.END_OF_FAIL]: States.ERROR,
  [PathCharTypes.ELSE]: [States.IN_SINGLE_QUOTE, Actions.APPEND]
}

pathStateMachine[States.IN_DOUBLE_QUOTE] = {
  [PathCharTypes.DOUBLE_QUOTE]: [States.IN_SUB_PATH, Actions.APPEND],
  [PathCharTypes.END_OF_FAIL]: States.ERROR,
  [PathCharTypes.ELSE]: [States.IN_DOUBLE_QUOTE, Actions.APPEND]
}

/**
 * Check if an expression is a literal value.
 */
const literalValueRE = /^\s?(?:true|false|-?[\d.]+|'[^']*'|"[^"]*")\s?$/
function isLiteral (exp: string): boolean {
  return literalValueRE.test(exp)
}

/**
 * Strip quotes from a string
 */
function stripQuotes (str: string): string {
  const a = str.charCodeAt(0)
  const b = str.charCodeAt(str.length - 1)
  return a === b && (a === 0x22 || a === 0x27)
    ? str.slice(1, -1)
    : str
}

/**
 * Determine the type of a character in a keypath.
 */
function getPathCharType (ch?: string): string {
    if (ch === undefined || ch === null) { return PathCharTypes.END_OF_FAIL }
  
    const code = ch.charCodeAt(0)
  
    switch (code) {
      case 0x5B: // [
      case 0x5D: // ]
      case 0x2E: // .
      case 0x22: // "
      case 0x27: // '
        return ch
  
      case 0x5F: // _
      case 0x24: // $
      case 0x2D: // -
        return PathCharTypes.IDENT
  
      case 0x09: // Tab
      case 0x0A: // Newline
      case 0x0D: // Return
      case 0xA0:  // No-break space
      case 0xFEFF:  // Byte Order Mark
      case 0x2028:  // Line Separator
      case 0x2029:  // Paragraph Separator
        return PathCharTypes.WORKSPACE
    }
  
    return PathCharTypes.IDENT
  }

/**
 * Format a subPath, return its plain form if it is
 * a literal string or number. Otherwise prepend the
 * dynamic indicator (*).
 */
function formatSubPath (path: string): boolean | string {
  const trimmed = path.trim()
  // invalid leading 0
  if (path.charAt(0) === '0' && isNaN(parseInt(path))) { return false }

  return isLiteral(trimmed)
    ? stripQuotes(trimmed)
    : PathCharTypes.ASTARISK + trimmed
}

/**
 * Parse a string path into an array of segments
 */
export function parse (path: Path): string[] | undefined {
  const keys = [] as string[]
  let index = -1
  let mode = States.BEFORE_PATH
  let subPathDepth = 0
  let c: string | undefined
  let key: any
  let newChar: string
  let type: string
  let transition: PathState
  let action: Function
  let typeMap: PathStateMachine
  const actions = [] as Function[]

  actions[Actions.APPEND] = (): void => {
    if (key === undefined) {
      key = newChar
    } else {
      key += newChar
    }
  }

  actions[Actions.PUSH] = () => {
    if (key !== undefined) {
      keys.push(key)
      key = undefined
    }
  }

  actions[Actions.INC_SUB_PATH_DEPTH] = () => {
    actions[Actions.APPEND]()
    subPathDepth++
  }

  actions[Actions.PUSH_SUB_PATH] = () => {
    if (subPathDepth > 0) {
      subPathDepth--
      mode = States.IN_SUB_PATH
      actions[Actions.APPEND]()
    } else {
      subPathDepth = 0
      if (key === undefined) { return false }
      key = formatSubPath(key)
      if (key === false) {
        return false
      } else {
        actions[Actions.PUSH]()
      }
    }
  }

  function maybeUnescapeQuote () {
    const nextChar = path[index + 1]
    if ((mode === States.IN_SINGLE_QUOTE && nextChar === PathCharTypes.SINGLE_QUOTE) ||
      (mode === States.IN_DOUBLE_QUOTE && nextChar === PathCharTypes.DOUBLE_QUOTE)) {
      index++
      newChar = '\\' + nextChar
      actions[Actions.APPEND]()
      return true
    }
  }

  while (mode !== null) {
    index++
    c = path[index]

    if (c === '\\' && maybeUnescapeQuote()) {
      continue
    }

    type = getPathCharType(c)
    typeMap = pathStateMachine[mode]
    transition = typeMap[type] || typeMap[PathCharTypes.ELSE] || States.ERROR

    // check parse error
    if (transition === States.ERROR) {
      return
    }

    mode = transition[0]
    if (transition[1] !== undefined) {
      action = actions[transition[1]]
      if (action) {
        newChar = c
        if (action() === false) {
          return
        }
      }
    }
    
    // check parse finish
    if (mode === States.AFTER_PATH) {
      return keys
    }
  }
}

export type PathValue = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: PathValue }
  | PathValue[]

// path token cache
const cache = new Map<Path, string[]>()

export function resolveValue (obj: unknown, path: Path): PathValue {
  // check object
  if (!isObject(obj)) { return null }

  // parse path
  let hit = cache.get(path)
  if (!hit) {
    hit = parse(path)
    if (hit) {
      cache.set(path, hit)
    }
  }

  // check hit
  if (!hit) { return null }
  
  // resolve path value
  const len = hit.length
  let last = obj
  let i = 0
  while (i < len) {
    const val = last[hit[i]]
    if (val === undefined) {
      return null
    }
    last = val
    i++
  }

  return last
}