/** Linux development-only admission guard for the complete benchmark process tree. */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const [runId, executable, ...args] = process.argv.slice(2)
if (!runId || !/^[a-z0-9-]+$/u.test(runId) || !executable)
  throw new Error('Usage: run-m7-bounded.ts unique-run-id executable [arguments]')
const memoryGiB = Number(process.env.PUREJSIMAGE_M7_MEMORY_GIB ?? 3)
const cpuQuotaPercent = Number(process.env.PUREJSIMAGE_M7_CPU_PERCENT ?? 200)
if (cpuQuotaPercent !== 200 && cpuQuotaPercent !== 400 && cpuQuotaPercent !== 800)
  throw new Error('M7 CPU quota must be 200, 400 or 800 percent')
if (memoryGiB !== 3 && memoryGiB !== 8 && memoryGiB !== 10)
  throw new Error('M7 job memory must be 3, 8 or 10 GiB')
const minimumAvailableBytes = (memoryGiB * 2 + 2) * 1024 ** 3
const available = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(await readFile('/proc/meminfo', 'utf8'))
const availableBytes = Number(available?.[1]) * 1024
if (!Number.isSafeInteger(availableBytes) || availableBytes < minimumAvailableBytes)
  throw new Error(
    `M7 ${memoryGiB} GiB job requires at least ${memoryGiB * 2 + 2} GiB of available host memory`,
  )
const policy = {
  memoryMaxBytes: memoryGiB * 1024 ** 3,
  memoryHighBytes: memoryGiB * 960 * 1024 ** 2,
  minimumAvailableBytes,
  swapMaxBytes: 0,
  maximumTasks: 256,
  cpuQuotaPercent,
  oomScoreAdjust: 1000,
  node: process.execPath,
  runtime: process.version,
  unit: 'purejsimage-m7-bounded',
  concurrency: 'One fixed user-service name admits only one complete benchmark tree at a time',
}
const directory = '.tmp/jpegxl-m7/bounded-runs'
await mkdir(directory, { recursive: true })
const reportPath = `${directory}/${runId}.json`
const startedAt = new Date().toISOString()
// Exclusive creation preserves previous evidence and prevents accidental reuse of a run ID.
await writeFile(
  reportPath,
  `${JSON.stringify({ startedAt, policy, executable, args, status: 'starting' }, null, 2)}\n`,
  { flag: 'wx' },
)
const child = spawn(
  '/usr/bin/systemd-run',
  [
    '--user',
    `--unit=${policy.unit}`,
    '--collect',
    '--wait',
    '--pipe',
    `--setenv=PATH=${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    `--property=MemoryMax=${policy.memoryMaxBytes}`,
    `--property=MemoryHigh=${policy.memoryHighBytes}`,
    '--property=MemorySwapMax=0',
    '--property=OOMPolicy=stop',
    // Prefer losing a reproducible benchmark over a desktop app during global pressure.
    `--property=OOMScoreAdjust=${policy.oomScoreAdjust}`,
    `--property=TasksMax=${policy.maximumTasks}`,
    `--property=CPUQuota=${policy.cpuQuotaPercent}%`,
    `--working-directory=${process.cwd()}`,
    executable,
    ...args,
  ],
  { stdio: ['ignore', 'inherit', 'pipe'] },
)
let diagnostics = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (value: string) => {
  process.stderr.write(value)
  diagnostics = (diagnostics + value).slice(-65_536)
})
const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
  (resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  },
)
// systemd treats an explicit SIGTERM stop as successful service shutdown, not job completion.
const terminated = /Main processes terminated with: code=killed,/u.test(diagnostics)
const completed = result.code === 0 && !terminated
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      policy,
      availableBytes,
      executable,
      args,
      ...result,
      status: terminated ? 'terminated' : completed ? 'completed' : 'failed',
      diagnostics,
    },
    null,
    2,
  )}\n`,
)
process.exitCode = completed ? 0 : result.code || 1
