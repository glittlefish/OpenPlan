export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Link { uid: number; type: LinkType; lag: number }
export interface Assignment { res: number; units: number }
export interface Split { at: number; gap: number }

export interface Task {
  uid: number;
  name: string;
  level: number;
  duration: number;
  milestone: boolean;
  percent: number;
  notes: string;
  preds: Link[];
  assignments: Assignment[];
  constraint: string;
  constraintDate: string;
  deadline: string;
  type: string;
  effortDriven: boolean;
  fixedCost: number;
  actualStart: string;
  actualFinish: string;
  splits: Split[];
  levelDelay: number;
  priority: number;
  custom: Record<string, string | number>;
  /** Manual per-task box style override for WBS/Network charts; beats all box style rules. */
  customStyle?: BoxStyle | null;
}

export interface Resource {
  uid: number;
  name: string;
  initials: string;
  role: string;
  type: string;
  kind: 'Work' | 'Material' | 'Cost';
  materialLabel: string;
  maxUnits: number;
  rate: number;
  costPerUse: number;
  rates: { from: string; rate: number }[];
  workDays: number[];
  vacations: string[];
  reportsTo: number | null;
}

export interface CustomField { id: string; name: string; type: 'text' | 'number' }

/** Visual style attributes for chart boxes (WBS / Network). Unset keys fall through to lower-priority rules. */
export interface BoxStyle {
  borderColor?: string;                       // hex color or CSS var token
  borderWidth?: 1 | 2 | 3;
  borderDash?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;                        // hex color or 'transparent'
  textColor?: string;
  bold?: boolean;
  shadowColor?: string;                      // empty/undefined = no shadow
  shadowX?: number;                          // -4..4
  shadowY?: number;
}

/** One condition of a box style rule; all conditions of a rule combine with AND. */
export interface BoxCondition { field: string; op: string; value: any }

/** Rule-driven box styling (PRD M14). Array order = priority (ascending evaluation). */
export interface BoxRule {
  id: string;
  name: string;
  enabled: boolean;
  builtin: boolean;                          // built-ins can be disabled but not deleted
  scope: 'partial' | 'full';                  // partial fills only set attributes; full overrides wholesale
  views: ('wbs' | 'network')[];               // which charts the rule applies to
  conditions: BoxCondition[];
  style: BoxStyle;
}

export interface Project {
  version: number;
  name: string;
  organization: string;
  manager: string;
  status: string;
  issueDate: string;
  start: string;
  statusDate: string;
  budget: number;
  currency: string;
  hoursPerDay: number;
  holidays: string[];
  customFields: CustomField[];
  baseline: { savedAt: string; tasks: Record<number, any> } | null;
  nextUid: number;
  tasks: Task[];
  resources: Resource[];
  /** Network diagram: manual node positions (uid -> SVG coordinates), empty when layout is automatic. */
  netPos?: Record<number, { x: number; y: number }>;
  /** WBS/Network chart: box style rules, ordered by priority (first entries evaluated first). */
  boxRules?: BoxRule[];
}

/* Computed schedule rows and results come from the JavaScript engine (core.js). */
export interface Row {
  task: Task;
  i: number;
  id: number;
  wbs: string;
  summary: boolean;
  parent: number;
  children: number[];
  leaves: number[];
  es: number; ef: number; ls: number; lf: number; esEarly: number;
  slack: number;
  freeSlack: number;
  critical: boolean;
  milestone: boolean;
  duration: number;
  startDn: number;
  finishDn: number;
  percent: number;
  cost: number;
  work: number;
  actualCost: number;
  actualWork: number;
  bcws: number; bcwp: number; acwp: number;
  segs: [number, number][];
  material: Record<number, number>;
  names: string;
  late: boolean;
  over: boolean;
  cyclic: boolean;
  conflict: string;
  missedDeadline: boolean;
  base: { startDn: number; finishDn: number; duration: number; cost: number; work: number } | null;
  startVar: number;
  finishVar: number;
  costVar: number;
  slipped: boolean;
}

export interface ResStat {
  peak: number;
  overDays: number[];
  over: boolean;
  work: number;
  cost: number;
  qty: number;
  capOn: (day: number) => number;
}

export interface Calendar {
  first: number;
  isWorking: (dn: number) => boolean;
  date: (n: number) => number;
  indexOf: (dn: number) => number;
  finishIndex: (dn: number) => number;
}

export interface Schedule {
  rows: Row[];
  edges: { from: number; to: number; type: LinkType; lag: number }[];
  cal: Calendar;
  load: Record<number, Record<number, number>>;
  contrib: Record<number, Record<number, number[]>>;
  resStats: Record<number, ResStat>;
  ev: { bac: number; bcws: number; bcwp: number; acwp: number; sv: number; cv: number; spi: number | null; cpi: number | null; eac: number; vac: number };
  dayCost: Record<number, number>;
  cycle: number[];
  duration: number;
  statusDn: number;
  startDn: number;
  finishDn: number;
  totalCost: number;
  totalWork: number;
}

export type ViewName = 'gantt' | 'board' | 'network' | 'wbs' | 'resources' | 'org' | 'workload' | 'budget' | 'reports';
