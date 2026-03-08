import { useState } from "react";
import WorkOrderList from "../components/WorkOrderList";
import WorkOrderDetail from "../components/WorkOrderDetail";
import WorkOrderCreate from "../components/WorkOrderCreate";

export default function WorkOrders() {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [spawnType, setSpawnType] = useState(null); // 'corrective' | 'replacement'
  const [parentWO, setParentWO] = useState(null);

  const handleSpawn = (type, wo) => {
    setSpawnType(type);
    setParentWO(wo);
    setCreating(true);
    setSelected(null);
  };

  return (
    <div className="wo-page">
      <WorkOrderList
        onSelect={setSelected}
        selected={selected}
        onNewRequest={() => { setSpawnType(null); setParentWO(null); setCreating(true); }}
      />
      {creating && (
        <WorkOrderCreate
          spawnType={spawnType}
          parentWO={parentWO}
          onClose={() => { setCreating(false); setSpawnType(null); setParentWO(null); }}
        />
      )}
      {selected && !creating && (
        <WorkOrderDetail
          wo={selected}
          onClose={() => setSelected(null)}
          onSpawn={handleSpawn}
        />
      )}
    </div>
  );
}
