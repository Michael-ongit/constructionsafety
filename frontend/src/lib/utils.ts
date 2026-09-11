import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatActivity(activity: string | null | undefined): string {
  if (!activity) return activity || '--'
  return activity.replace(/_done$/i, '')
}

export function getIdealTime(activityName: string | null | undefined): number | null {
  if (!activityName) return null;
  const key = activityName.toLowerCase().replace(/_done$/i, '').trim();
  const IDEAL_TIMES: Record<string, number> = {
    'outer_shuttering': 3,
    'bulkhead_fixing': 3,
    'oiling': 0,
    'cage_lowering': 5,
    'inner_mould_fixing': 6,
    'concrete': 6,
    'curing': 336,
    'shifting': 3,
  };
  return IDEAL_TIMES[key] ?? null;
}

