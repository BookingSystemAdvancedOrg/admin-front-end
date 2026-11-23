import { planFromLayout } from '../features/layout-editor/activeLayout'
import type { ActivePlan, PublicLayout } from '../features/layout-editor/activeLayout'

/** Ett bord i en testplan; utan `label` numreras det som på gästsajten. */
export interface TestTable {
  id: string
  seats: number
  floor?: string
  label?: string
}

/** En publicerad plan (GET /layout/active) med borden på rad, en våning om inget annat anges. */
export function testLayout(
  tables: TestTable[],
  floors: { floorId: string; name: string; level: number }[] = [{ floorId: 'f1', name: 'Entréplan', level: 0 }],
): PublicLayout {
  return {
    floors,
    elements: tables.map((t, i) => ({
      elementId: t.id,
      type: 'table' as const,
      x: 1 + i * 2,
      y: 0,
      z: 2,
      width: 1.2,
      height: 0.75,
      depth: 0.8,
      rotationY: 0,
      floorId: t.floor ?? floors[0]?.floorId,
      shape: 'rect',
      seats: t.seats,
      ...(t.label ? { label: t.label } : {}),
    })),
  }
}

/** Samma plan som loadActiveLayout ger (våningar och etiketter). */
export function testPlan(...args: Parameters<typeof testLayout>): ActivePlan {
  return planFromLayout(testLayout(...args))!
}
