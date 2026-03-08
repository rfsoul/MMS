import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workOrders, assets } from '../../services/api.js'
import WorkOrderList from './WorkOrderList.jsx'
import WorkOrderDetail from './WorkOrderDetail.jsx'
import WorkOrderCreate from './WorkOrderCreate.jsx'

function toArray(res) {
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.data)) return res.data
  if (Array.isArray(res?.work_orders)) return res.work_orders
  return []
}

export default function WorkOrdersPage() {
  const queryClient = useQueryClient()
  const [selected, setSelected]   = useState(null)
  const [creating, setCreating]   = useState(false)
  const [spawnType, setSpawnType] = useState(null)
  const [parentWO, setParentWO]   = useState(null)

  // ── Fetch WOs ──────────────────────────────────────────────
  const { data: rawWOs = [], isLoading, error } = useQuery({
    queryKey: ['workOrders'],
    queryFn: async () => toArray(await workOrders.list()),
  })

  // ── Fetch flat asset list for label enrichment ─────────────
  const { data: assetList = [] } = useQuery({
    queryKey: ['assets', 'flat'],
    queryFn: () => assets.listFlat({ limit: 500 }),
  })

  // ── Build asset lookup map: asset_graph_id → display label ─
  const assetMap = useMemo(() => {
    const map = {}
    assetList.forEach(a => {
      const parts = [a.code, a.name].filter(Boolean)
      const location = [a.building_name, a.space_name].filter(Boolean).join(' / ')
      map[a.asset_graph_id] = location
        ? `${parts.join(' — ')} (${location})`
        : parts.join(' — ') || a.asset_graph_id
    })
    return map
  }, [assetList])

  // ── Enrich WOs with asset_label ────────────────────────────
  const wos = useMemo(() =>
    rawWOs.map(wo => ({
      ...wo,
      asset_label: wo.asset_graph_id ? (assetMap[wo.asset_graph_id] || wo.asset_graph_id) : null,
    })),
    [rawWOs, assetMap]
  )

  // ── Keep selected WO in sync when list refreshes ───────────
  const selectedWO = selected
    ? wos.find(w => w.id === selected.id) || selected
    : null

  // ── Update WO ──────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => workOrders.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workOrders'] })
    },
  })

  // ── Create WO ──────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data) => workOrders.create(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['workOrders'] })
      setCreating(false)
      setSpawnType(null)
      setParentWO(null)
      // Select the newly created WO
      setSelected(created)
    },
  })

  const handleSpawn = (type, wo) => {
    setSpawnType(type)
    setParentWO(wo)
    setSelected(null)
    setCreating(true)
  }

  const handleUpdate = (id, data) => {
    updateMutation.mutate({ id, data })
  }

  const handleCloseCreate = () => {
    setCreating(false)
    setSpawnType(null)
    setParentWO(null)
  }

  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: 13 }}>
      Failed to load work orders: {error.message}
    </div>
  )

  return (
    <>
      <WorkOrderList
        wos={wos}
        loading={isLoading}
        selected={selectedWO}
        onSelect={setSelected}
        onNew={() => { setSpawnType(null); setParentWO(null); setCreating(true) }}
      />

      {selectedWO && !creating && (
        <WorkOrderDetail
          wo={selectedWO}
          allWOs={wos}
          onClose={() => setSelected(null)}
          onSpawn={handleSpawn}
          onUpdate={handleUpdate}
          saving={updateMutation.isPending}
        />
      )}

      {creating && (
        <WorkOrderCreate
          spawnType={spawnType}
          parentWO={parentWO}
          onClose={handleCloseCreate}
          onCreate={(data) => createMutation.mutate(data)}
          saving={createMutation.isPending}
          error={createMutation.error?.message}
        />
      )}
    </>
  )
}
