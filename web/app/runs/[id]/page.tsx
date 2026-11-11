import { notFound } from "next/navigation";
import { Suspense } from "react";
import RunView from "@/components/RunView";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Run({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound(); // runId va al filtro de Realtime: solo UUID
  return <RunView runId={id} />;
}

export default function RunPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="p-6">Cargando corrida…</p>}>
      <Run params={params} />
    </Suspense>
  );
}
