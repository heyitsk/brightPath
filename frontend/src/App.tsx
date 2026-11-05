import { useEffect, useState } from 'react'

type Health = {
  status: 'ok' | 'degraded'
  services: { database: 'up' | 'down'; redis: 'up' | 'down' }
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Request failed'))
  }, [])

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold tracking-tight">BrightPath</h1>
        <p className="mt-1 text-sm text-slate-500">Frontend is up. Backend status:</p>

        <div className="mt-6 text-sm">
          {error && <p className="text-red-600">Backend unreachable: {error}</p>}
          {!error && !health && <p className="text-slate-400">Checking…</p>}
          {health && (
            <ul className="space-y-2">
              <StatusRow label="API" up={health.status === 'ok'} />
              <StatusRow label="Postgres" up={health.services.database === 'up'} />
              <StatusRow label="Redis" up={health.services.redis === 'up'} />
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}

function StatusRow({ label, up }: { label: string; up: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}
      >
        {up ? 'up' : 'down'}
      </span>
    </li>
  )
}

export default App
