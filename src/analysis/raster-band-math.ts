import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { NumericArray, NumericSampleType, NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import {
  admitRasterAllocation,
  assertTileCoversRegion,
  normalizeRasterNoData,
  normalizeRasterTileRegion,
  numericRasterPlanSchemaVersion,
  rasterNoDataNumber,
  rasterSampleIsNoData,
  resolveRasterOperationLimits,
  type RasterNoData,
  type RasterOperationLimits,
  type RasterTileRegion,
} from './raster-contracts.ts'

export const rasterBandMathAlgorithm = Object.freeze({
  id: 'purejsimage.raster.band-math',
  version: 1,
})

export type RasterBandValueMode = 'raw' | 'scaled'

export interface RasterBandInputPlan {
  readonly name: string
  readonly component: number
  readonly valueMode: RasterBandValueMode
  readonly scale: number
  readonly offset: number
  readonly noData: RasterNoData
}

export type RasterBandMathFunction = 'abs' | 'sqrt' | 'log' | 'exp' | 'min' | 'max' | 'pow'

export type RasterBandMathExpression =
  | { readonly kind: 'literal'; readonly value: number }
  | { readonly kind: 'input'; readonly name: string; readonly inputIndex: number }
  | {
      readonly kind: 'unary'
      readonly operator: '+' | '-'
      readonly operand: RasterBandMathExpression
    }
  | {
      readonly kind: 'binary'
      readonly operator: '+' | '-' | '*' | '/'
      readonly left: RasterBandMathExpression
      readonly right: RasterBandMathExpression
    }
  | {
      readonly kind: 'call'
      readonly function: RasterBandMathFunction
      readonly arguments: readonly RasterBandMathExpression[]
    }

export interface RasterBandMathPlan {
  readonly schemaVersion: 1
  readonly algorithm: typeof rasterBandMathAlgorithm
  readonly expression: string
  readonly ast: RasterBandMathExpression
  readonly inputs: readonly RasterBandInputPlan[]
  readonly outputSampleType: 'float32' | 'float64'
  readonly outputNoData: RasterNoData
  readonly divideByZero: 'nodata' | 'zero'
  readonly nonFinite: 'nodata' | 'allow'
  readonly clamp?: readonly [minimum: number, maximum: number]
  readonly operationCount: number
  readonly expressionDepth: number
}

export interface RasterBandMathPlanInput {
  readonly name: string
  readonly component?: number
  readonly valueMode: RasterBandValueMode
  readonly scale?: number
  readonly offset?: number
  readonly noData?: RasterNoData
}

export interface CreateRasterBandMathPlanOptions {
  readonly expression: string
  readonly inputs: readonly RasterBandMathPlanInput[]
  readonly outputSampleType?: 'float32' | 'float64'
  readonly outputNoData?: RasterNoData
  readonly divideByZero?: 'nodata' | 'zero'
  readonly nonFinite?: 'nodata' | 'allow'
  readonly clamp?: readonly [minimum: number, maximum: number]
  readonly limits?: Readonly<RasterOperationLimits>
}

interface NumberToken {
  readonly kind: 'number'
  readonly value: number
  readonly offset: number
}

interface NameToken {
  readonly kind: 'name'
  readonly value: string
  readonly offset: number
}

interface PunctuationToken {
  readonly kind: 'punctuation'
  readonly value: '+' | '-' | '*' | '/' | '(' | ')' | ','
  readonly offset: number
}

interface EndToken {
  readonly kind: 'end'
  readonly offset: number
}

type Token = NumberToken | NameToken | PunctuationToken | EndToken

const identifierStart = (character: string): boolean => /[A-Za-z_]/u.test(character)
const identifierPart = (character: string): boolean => /[A-Za-z0-9_]/u.test(character)
const digit = (character: string): boolean => character >= '0' && character <= '9'

const tokenize = (expression: string): readonly Token[] => {
  const result: Token[] = []
  let offset = 0
  while (offset < expression.length) {
    const character = expression[offset] ?? ''
    if (/\s/u.test(character)) {
      offset += 1
      continue
    }
    if ('+-*/(),'.includes(character)) {
      result.push({
        kind: 'punctuation',
        value: character as PunctuationToken['value'],
        offset,
      })
      offset += 1
      continue
    }
    if (identifierStart(character)) {
      const start = offset
      offset += 1
      while (offset < expression.length && identifierPart(expression[offset] ?? '')) offset += 1
      result.push({ kind: 'name', value: expression.slice(start, offset), offset: start })
      continue
    }
    if (digit(character) || character === '.') {
      const start = offset
      let sawDigit = false
      while (digit(expression[offset] ?? '')) {
        sawDigit = true
        offset += 1
      }
      if ((expression[offset] ?? '') === '.') {
        offset += 1
        while (digit(expression[offset] ?? '')) {
          sawDigit = true
          offset += 1
        }
      }
      if (!sawDigit) throw invalidInput(`Invalid band-math token at offset ${start}`)
      if ((expression[offset] ?? '').toLowerCase() === 'e') {
        offset += 1
        if ((expression[offset] ?? '') === '+' || (expression[offset] ?? '') === '-') offset += 1
        const exponentStart = offset
        while (digit(expression[offset] ?? '')) offset += 1
        if (exponentStart === offset) throw invalidInput(`Invalid exponent at offset ${start}`)
      }
      const value = Number(expression.slice(start, offset))
      if (!Number.isFinite(value)) throw invalidInput(`Non-finite literal at offset ${start}`)
      result.push({ kind: 'number', value, offset: start })
      continue
    }
    throw invalidInput(`Invalid band-math token at offset ${offset}`)
  }
  result.push({ kind: 'end', offset: expression.length })
  return Object.freeze(result)
}

const functionArities: Readonly<Record<RasterBandMathFunction, readonly [number, number]>> =
  Object.freeze({
    abs: Object.freeze([1, 1] as const),
    sqrt: Object.freeze([1, 1] as const),
    log: Object.freeze([1, 1] as const),
    exp: Object.freeze([1, 1] as const),
    min: Object.freeze([2, 2] as const),
    max: Object.freeze([2, 2] as const),
    pow: Object.freeze([2, 2] as const),
  })

const isFunction = (value: string): value is RasterBandMathFunction =>
  value === 'abs' ||
  value === 'sqrt' ||
  value === 'log' ||
  value === 'exp' ||
  value === 'min' ||
  value === 'max' ||
  value === 'pow'

class BandMathParser {
  readonly #tokens: readonly Token[]
  readonly #inputs: ReadonlyMap<string, number>
  #index = 0
  #operations = 0
  #maximumDepth = 0

  constructor(tokens: readonly Token[], inputs: ReadonlyMap<string, number>) {
    this.#tokens = tokens
    this.#inputs = inputs
  }

  parse(): {
    readonly ast: RasterBandMathExpression
    readonly operations: number
    readonly depth: number
  } {
    const ast = this.#additive(1)
    const token = this.#peek()
    if (token.kind !== 'end') throw invalidInput(`Unexpected token at offset ${token.offset}`)
    return Object.freeze({ ast, operations: this.#operations, depth: this.#maximumDepth })
  }

  #peek(): Token {
    return this.#tokens[this.#index] ?? { kind: 'end', offset: 0 }
  }

  #take(): Token {
    const token = this.#peek()
    this.#index += 1
    return token
  }

  #punctuation(value: PunctuationToken['value']): boolean {
    const token = this.#peek()
    if (token.kind !== 'punctuation' || token.value !== value) return false
    this.#index += 1
    return true
  }

  #track(depth: number): void {
    this.#maximumDepth = Math.max(this.#maximumDepth, depth)
  }

  #additive(depth: number): RasterBandMathExpression {
    this.#track(depth)
    let result = this.#multiplicative(depth + 1)
    while (true) {
      const token = this.#peek()
      if (token.kind !== 'punctuation' || (token.value !== '+' && token.value !== '-')) break
      this.#take()
      result = Object.freeze({
        kind: 'binary',
        operator: token.value,
        left: result,
        right: this.#multiplicative(depth + 1),
      })
      this.#operations += 1
    }
    return result
  }

  #multiplicative(depth: number): RasterBandMathExpression {
    this.#track(depth)
    let result = this.#unary(depth + 1)
    while (true) {
      const token = this.#peek()
      if (token.kind !== 'punctuation' || (token.value !== '*' && token.value !== '/')) break
      this.#take()
      result = Object.freeze({
        kind: 'binary',
        operator: token.value,
        left: result,
        right: this.#unary(depth + 1),
      })
      this.#operations += 1
    }
    return result
  }

  #unary(depth: number): RasterBandMathExpression {
    this.#track(depth)
    const token = this.#peek()
    if (token.kind === 'punctuation' && (token.value === '+' || token.value === '-')) {
      this.#take()
      this.#operations += 1
      return Object.freeze({
        kind: 'unary',
        operator: token.value,
        operand: this.#unary(depth + 1),
      })
    }
    return this.#primary(depth + 1)
  }

  #primary(depth: number): RasterBandMathExpression {
    this.#track(depth)
    const token = this.#take()
    if (token.kind === 'number') return Object.freeze({ kind: 'literal', value: token.value })
    if (token.kind === 'name') {
      if (this.#punctuation('(')) {
        if (!isFunction(token.value))
          throw invalidInput(`Unknown band-math function ${token.value}`)
        const args: RasterBandMathExpression[] = []
        if (!this.#punctuation(')')) {
          do args.push(this.#additive(depth + 1))
          while (this.#punctuation(','))
          if (!this.#punctuation(')')) throw invalidInput(`Expected ')' after ${token.value}`)
        }
        const [minimum, maximum] = functionArities[token.value]
        if (args.length < minimum || args.length > maximum) {
          throw invalidInput(`${token.value} requires ${minimum} argument(s)`)
        }
        this.#operations += 1
        return Object.freeze({
          kind: 'call',
          function: token.value,
          arguments: Object.freeze(args),
        })
      }
      const inputIndex = this.#inputs.get(token.value)
      if (inputIndex === undefined)
        throw invalidInput(`Unknown band-math identifier ${token.value}`)
      return Object.freeze({ kind: 'input', name: token.value, inputIndex })
    }
    if (token.kind === 'punctuation' && token.value === '(') {
      const result = this.#additive(depth + 1)
      if (!this.#punctuation(')'))
        throw invalidInput(`Expected ')' at offset ${this.#peek().offset}`)
      return result
    }
    throw invalidInput(`Expected band-math expression at offset ${token.offset}`)
  }
}

const finite = (value: number | undefined, fallback: number, name: string): number => {
  const result = value ?? fallback
  if (!Number.isFinite(result)) throw invalidInput(`${name} must be finite`)
  return result
}

const inputName = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value)) {
    throw invalidInput('Band input names must be bounded identifiers')
  }
  return value
}

export const createRasterBandMathPlan = (
  options: Readonly<CreateRasterBandMathPlanOptions>,
): RasterBandMathPlan => {
  const limits = resolveRasterOperationLimits(options.limits)
  if (options.expression.length < 1 || options.expression.length > limits.maxExpressionLength) {
    throw invalidInput('Band-math expression length is outside the configured limit')
  }
  if (options.inputs.length < 1 || options.inputs.length > limits.maxInputs) {
    throw invalidInput('Band-math input count is outside the configured limit')
  }
  const names = new Map<string, number>()
  const inputs = options.inputs.map((entry, index) => {
    const name = inputName(entry.name)
    if (names.has(name)) throw invalidInput(`Duplicate band input ${name}`)
    names.set(name, index)
    const component = entry.component ?? 0
    if (!Number.isSafeInteger(component) || component < 0) {
      throw invalidInput(`Band input ${name} has an invalid component`)
    }
    if (entry.valueMode !== 'raw' && entry.valueMode !== 'scaled') {
      throw invalidInput(`Band input ${name} has an invalid value mode`)
    }
    return Object.freeze({
      name,
      component,
      valueMode: entry.valueMode,
      scale: finite(entry.scale, 1, `${name} scale`),
      offset: finite(entry.offset, 0, `${name} offset`),
      noData: normalizeRasterNoData(entry.noData ?? { kind: 'none' }),
    })
  })
  const parsed = new BandMathParser(tokenize(options.expression), names).parse()
  if (parsed.depth > limits.maxExpressionDepth) {
    throw invalidInput('Band-math expression exceeds maxExpressionDepth')
  }
  if (parsed.operations > limits.maxExpressionOperations) {
    throw invalidInput('Band-math expression exceeds maxExpressionOperations')
  }
  const clamp = options.clamp
  if (
    clamp !== undefined &&
    (clamp.length !== 2 ||
      !Number.isFinite(clamp[0]) ||
      !Number.isFinite(clamp[1]) ||
      clamp[0] > clamp[1])
  ) {
    throw invalidInput('Band-math clamp must be an ordered finite pair')
  }
  const divideByZero = options.divideByZero ?? 'nodata'
  const nonFinite = options.nonFinite ?? 'nodata'
  if (divideByZero !== 'nodata' && divideByZero !== 'zero') {
    throw invalidInput('Unsupported divide-by-zero policy')
  }
  if (nonFinite !== 'nodata' && nonFinite !== 'allow') {
    throw invalidInput('Unsupported non-finite policy')
  }
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    algorithm: rasterBandMathAlgorithm,
    expression: options.expression,
    ast: parsed.ast,
    inputs: Object.freeze(inputs),
    outputSampleType: options.outputSampleType ?? 'float32',
    outputNoData: normalizeRasterNoData(options.outputNoData ?? { kind: 'nan' }),
    divideByZero,
    nonFinite,
    ...(clamp === undefined ? {} : { clamp: Object.freeze([clamp[0], clamp[1]] as const) }),
    operationCount: parsed.operations,
    expressionDepth: parsed.depth,
  })
}

export const createNormalizedDifferencePlan = (
  left: Readonly<RasterBandMathPlanInput>,
  right: Readonly<RasterBandMathPlanInput>,
  options: Readonly<Omit<CreateRasterBandMathPlanOptions, 'expression' | 'inputs'>> = {},
): RasterBandMathPlan =>
  createRasterBandMathPlan({
    ...options,
    expression: `(${inputName(left.name)} - ${inputName(right.name)}) / (${left.name} + ${right.name})`,
    inputs: [left, right],
  })

export interface RasterLinearCombinationTerm extends RasterBandMathPlanInput {
  readonly coefficient: number
}

export const createLinearCombinationPlan = (
  terms: readonly RasterLinearCombinationTerm[],
  constant = 0,
  options: Readonly<Omit<CreateRasterBandMathPlanOptions, 'expression' | 'inputs'>> = {},
): RasterBandMathPlan => {
  if (terms.length < 1) throw invalidInput('Linear combination requires at least one term')
  if (!Number.isFinite(constant)) throw invalidInput('Linear combination constant must be finite')
  const expression = terms
    .map((term) => {
      if (!Number.isFinite(term.coefficient)) {
        throw invalidInput('Linear combination coefficient must be finite')
      }
      return `(${term.coefficient} * ${inputName(term.name)})`
    })
    .concat([String(constant)])
    .join(' + ')
  return createRasterBandMathPlan({ ...options, expression, inputs: terms })
}

export const createRasterSubtractionPlan = (
  minuend: Readonly<RasterBandMathPlanInput>,
  subtrahend: Readonly<RasterBandMathPlanInput>,
  options: Readonly<Omit<CreateRasterBandMathPlanOptions, 'expression' | 'inputs'>> = {},
): RasterBandMathPlan =>
  createRasterBandMathPlan({
    ...options,
    expression: `${inputName(minuend.name)} - ${inputName(subtrahend.name)}`,
    inputs: [minuend, subtrahend],
  })

const tileNumber = (tile: NumericTile, index: number): number => {
  const value = tile.data[index]
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput('Raster uint64 input exceeds exact numeric band-math conversion')
    }
    return Number(value)
  }
  return value ?? Number.NaN
}

const evaluateExpression = (
  expression: RasterBandMathExpression,
  values: Float64Array,
  divideByZero: RasterBandMathPlan['divideByZero'],
): number => {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'input') return values[expression.inputIndex] ?? Number.NaN
  if (expression.kind === 'unary') {
    const value = evaluateExpression(expression.operand, values, divideByZero)
    return expression.operator === '-' ? -value : value
  }
  if (expression.kind === 'binary') {
    const left = evaluateExpression(expression.left, values, divideByZero)
    const right = evaluateExpression(expression.right, values, divideByZero)
    if (expression.operator === '+') return left + right
    if (expression.operator === '-') return left - right
    if (expression.operator === '*') return left * right
    if (right === 0) return divideByZero === 'zero' ? 0 : Number.NaN
    return left / right
  }
  const first = evaluateExpression(
    expression.arguments[0] ?? { kind: 'literal', value: Number.NaN },
    values,
    divideByZero,
  )
  if (expression.function === 'abs') return Math.abs(first)
  if (expression.function === 'sqrt') return Math.sqrt(first)
  if (expression.function === 'log') return Math.log(first)
  if (expression.function === 'exp') return Math.exp(first)
  const second = evaluateExpression(
    expression.arguments[1] ?? { kind: 'literal', value: Number.NaN },
    values,
    divideByZero,
  )
  if (expression.function === 'min') return Math.min(first, second)
  if (expression.function === 'max') return Math.max(first, second)
  return first ** second
}

const outputArray = (
  sampleType: 'float32' | 'float64',
  length: number,
): Float32Array | Float64Array =>
  sampleType === 'float32' ? new Float32Array(length) : new Float64Array(length)

export const evaluateRasterBandMathTile = (
  plan: Readonly<RasterBandMathPlan>,
  tiles: readonly NumericTile[],
  regionValue?: Readonly<RasterTileRegion>,
  options: Readonly<{
    readonly signal?: AbortSignal
    readonly limits?: RasterOperationLimits
  }> = {},
): NumericTile => {
  if (
    plan.schemaVersion !== 1 ||
    plan.algorithm.id !== rasterBandMathAlgorithm.id ||
    plan.algorithm.version !== 1
  ) {
    throw invalidInput('Unsupported raster band-math plan')
  }
  if (tiles.length !== plan.inputs.length)
    throw invalidInput('Band-math tile count does not match its plan')
  const first = tiles[0]
  if (first === undefined) throw invalidInput('Band-math requires at least one tile')
  const region = normalizeRasterTileRegion(
    regionValue ?? { x: first.x, y: first.y, width: first.width, height: first.height },
  )
  const limits = resolveRasterOperationLimits(options.limits)
  admitRasterAllocation(region, plan.outputSampleType, 1, limits, plan.inputs.length * 8)
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    const input = plan.inputs[index]
    if (tile === undefined || input === undefined) throw invalidInput('Band-math input is missing')
    assertTileCoversRegion(tile, region)
    if (input.component >= tile.componentCount) {
      throw invalidInput(`Band-math component for ${input.name} is unavailable`)
    }
  }
  const data = outputArray(plan.outputSampleType, region.width * region.height)
  const values = new Float64Array(plan.inputs.length)
  const noData = rasterNoDataNumber(plan.outputNoData)
  let destination = 0
  for (let y = 0; y < region.height; y += 1) {
    throwIfAborted(options.signal)
    for (let x = 0; x < region.width; x += 1) {
      let valid = true
      for (let inputIndex = 0; inputIndex < plan.inputs.length; inputIndex += 1) {
        const input = plan.inputs[inputIndex]
        const tile = tiles[inputIndex]
        if (input === undefined || tile === undefined)
          throw invalidInput('Band-math input is missing')
        const tileX = region.x + x - tile.x
        const tileY = region.y + y - tile.y
        const raw = tileNumber(tile, numericTileSampleOffset(tile, tileX, tileY, input.component))
        if (rasterSampleIsNoData(raw, input.noData) || !Number.isFinite(raw)) {
          valid = false
          break
        }
        values[inputIndex] = input.valueMode === 'scaled' ? raw * input.scale + input.offset : raw
      }
      let value = valid ? evaluateExpression(plan.ast, values, plan.divideByZero) : noData
      let outputIsNoData = !valid
      if (!Number.isFinite(value) && plan.nonFinite === 'nodata') {
        value = noData
        outputIsNoData = true
      }
      if (!outputIsNoData && plan.clamp !== undefined && Number.isFinite(value)) {
        value = Math.max(plan.clamp[0], Math.min(plan.clamp[1], value))
      }
      data[destination] = value
      destination += 1
    }
  }
  return Object.freeze({
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    sampleType: plan.outputSampleType as NumericSampleType,
    componentCount: 1,
    layout: 'interleaved',
    rowStrideElements: region.width,
    data: data as NumericArray,
    release() {},
  })
}
