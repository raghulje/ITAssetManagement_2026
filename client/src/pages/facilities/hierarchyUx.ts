import type { FacilityTreeNode } from '../../api/client'

export const PHYSICAL_TYPE_CODES = [
  'SITE',
  'BUILDING',
  'FLOOR',
  'ZONE',
  'DEPARTMENT_AREA',
  'SPACE',
] as const

export type PhysicalTypeCode = (typeof PHYSICAL_TYPE_CODES)[number]

/** UX assist only — backend remains authoritative. */
export const SUGGESTED_CHILD_TYPES: Record<PhysicalTypeCode, PhysicalTypeCode[]> = {
  SITE: ['BUILDING'],
  BUILDING: ['FLOOR'],
  FLOOR: ['ZONE', 'DEPARTMENT_AREA', 'SPACE'],
  ZONE: ['SPACE'],
  DEPARTMENT_AREA: ['SPACE'],
  SPACE: [],
}

export const TYPE_ICON: Record<string, string> = {
  SITE: 'fas fa-map-marker-alt',
  BUILDING: 'fas fa-building',
  FLOOR: 'fas fa-layer-group',
  ZONE: 'fas fa-border-all',
  DEPARTMENT_AREA: 'fas fa-briefcase',
  SPACE: 'fas fa-door-open',
}

export type FacilityCounts = {
  SITE: number
  BUILDING: number
  FLOOR: number
  ZONE: number
  DEPARTMENT_AREA: number
  SPACE: number
}

export function emptyCounts(): FacilityCounts {
  return { SITE: 0, BUILDING: 0, FLOOR: 0, ZONE: 0, DEPARTMENT_AREA: 0, SPACE: 0 }
}

export function countTypes(trees: FacilityTreeNode[]): FacilityCounts {
  const counts = emptyCounts()
  const walk = (nodes: FacilityTreeNode[]) => {
    for (const n of nodes) {
      const code = n.location_type?.code
      if (code && code in counts) counts[code as keyof FacilityCounts] += 1
      if (n.children?.length) walk(n.children)
    }
  }
  walk(trees)
  return counts
}

export function findNode(trees: FacilityTreeNode[], id: number): FacilityTreeNode | null {
  for (const n of trees) {
    if (n.id === id) return n
    const found = findNode(n.children || [], id)
    if (found) return found
  }
  return null
}

export function collectDescendantIds(node: FacilityTreeNode): Set<number> {
  const ids = new Set<number>()
  const walk = (n: FacilityTreeNode) => {
    for (const c of n.children || []) {
      ids.add(c.id)
      walk(c)
    }
  }
  walk(node)
  return ids
}

export function flattenTypedNodes(trees: FacilityTreeNode[]): FacilityTreeNode[] {
  const out: FacilityTreeNode[] = []
  const walk = (nodes: FacilityTreeNode[]) => {
    for (const n of nodes) {
      out.push(n)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(trees)
  return out
}

export function ancestorIdsToExpand(trees: FacilityTreeNode[], nodeId: number): number[] {
  const path: number[] = []
  const walk = (nodes: FacilityTreeNode[], trail: number[]): boolean => {
    for (const n of nodes) {
      const next = [...trail, n.id]
      if (n.id === nodeId) {
        path.push(...trail)
        return true
      }
      if (n.children?.length && walk(n.children, next)) return true
    }
    return false
  }
  walk(trees, [])
  return path
}

export function defaultExpandedIds(trees: FacilityTreeNode[]): Set<number> {
  const ids = new Set<number>()
  const total = flattenTypedNodes(trees).length
  for (const root of trees) {
    ids.add(root.id)
    if (total < 50) {
      const expandAll = (n: FacilityTreeNode) => {
        ids.add(n.id)
        for (const c of n.children || []) expandAll(c)
      }
      expandAll(root)
    } else {
      for (const c of root.children || []) ids.add(c.id)
    }
  }
  return ids
}

export function errMessages(e: unknown): string[] {
  if (e && typeof e === 'object' && 'messages' in e && Array.isArray((e as { messages: unknown }).messages)) {
    return (e as { messages: string[] }).messages.map(String)
  }
  if (e instanceof Error) return [e.message]
  return [String(e)]
}

/** Keep nodes that match the query or have a matching descendant. */
export function filterTreeByName(trees: FacilityTreeNode[], query: string): FacilityTreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return trees
  const filterNode = (node: FacilityTreeNode): FacilityTreeNode | null => {
    const children = (node.children || [])
      .map(filterNode)
      .filter((c): c is FacilityTreeNode => c != null)
    const selfMatch = node.name.toLowerCase().includes(q)
      || (node.location_type?.code || '').toLowerCase().includes(q)
      || (node.location_type?.name || '').toLowerCase().includes(q)
      || (node.space_subtype?.name || '').toLowerCase().includes(q)
    if (!selfMatch && !children.length) return null
    return { ...node, children }
  }
  return trees.map(filterNode).filter((n): n is FacilityTreeNode => n != null)
}

/** Expand ancestors of every name match so search hits are visible. */
export function expandIdsForSearch(trees: FacilityTreeNode[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const ids: number[] = []
  const walk = (nodes: FacilityTreeNode[], trail: number[]) => {
    for (const n of nodes) {
      const nextTrail = [...trail, n.id]
      const selfMatch = n.name.toLowerCase().includes(q)
        || (n.location_type?.code || '').toLowerCase().includes(q)
        || (n.location_type?.name || '').toLowerCase().includes(q)
        || (n.space_subtype?.name || '').toLowerCase().includes(q)
      if (selfMatch) {
        ids.push(...trail)
        ids.push(n.id)
      }
      if (n.children?.length) walk(n.children, nextTrail)
    }
  }
  walk(trees, [])
  return ids
}

export function nodeMatchesSearch(node: FacilityTreeNode, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return node.name.toLowerCase().includes(q)
    || (node.location_type?.code || '').toLowerCase().includes(q)
    || (node.location_type?.name || '').toLowerCase().includes(q)
    || (node.space_subtype?.name || '').toLowerCase().includes(q)
}
