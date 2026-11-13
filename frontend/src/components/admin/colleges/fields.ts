import type { FieldDef, Opt } from '../crud/types'
import { OWNERSHIP_OPTIONS } from './data'
import type { College, Kind } from './types'

type Nested = Record<string, unknown> | null

const india = (r: unknown) => (r as College).india as Nested
const abroad = (r: unknown) => (r as College).abroad as Nested

/** true/false/null as a select: 'true' | 'false' | '' (empty = not checked yet, sent as null). */
const YES_NO: Opt[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]
const triState = (v: unknown) => (v === true ? 'true' : v === false ? 'false' : '')

/** The three-way questions; form-body.ts turns their values back into true / false. */
export const TRI_STATE = new Set(['india.nmcRecognised', 'abroad.nmcLengthOk', 'abroad.nmcEnglishOk', 'abroad.nmcInternshipOk'])

/** Eligibility object <-> one "Label: rule" per line. */
export function eligibilityText(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  return Object.entries(v as Record<string, string>)
    .map(([k, rule]) => `${k}: ${rule}`)
    .join('\n')
}

const NOT_CHECKED = 'Not checked yet'
const LINK_HINT = 'Full link starting with http:// or https://.'

/** Fields both kinds share. The place (state or country) depends on the kind. */
export function commonFields(kind: Kind): FieldDef[] {
  const place: FieldDef =
    kind === 'INDIA'
      ? { name: 'stateId', label: 'State', kind: 'select', lookup: 'states', nullable: true, emptyLabel: 'Not set', value: (r) => (r as College).state?.id }
      : { name: 'countryId', label: 'Country', kind: 'select', lookup: 'countries', nullable: true, emptyLabel: 'Not set', value: (r) => (r as College).country?.id }
  return [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 300 },
    { name: 'shortName', label: 'Short name', kind: 'text', nullable: true, maxLength: 60, hint: 'Abbreviation, if it has one.' },
    { name: 'city', label: 'City', kind: 'text', required: true, maxLength: 120 },
    place,
    { name: 'ownership', label: 'Ownership', kind: 'select', nullable: true, options: OWNERSHIP_OPTIONS, emptyLabel: 'Not set' },
    { name: 'establishedYear', label: 'Year founded', kind: 'number', nullable: true, min: 1800, max: 2100 },
    {
      name: 'courseLengthMonths',
      label: 'Course length (months)',
      kind: 'number',
      nullable: true,
      min: 1,
      max: 144,
      hint: 'Whole course, internship included. Decides how many fee years are needed.',
    },
    { name: 'description', label: 'Description', kind: 'textarea', nullable: true, hint: 'In our own words. Never copied from another site.' },
    { name: 'websiteUrl', label: 'College website', kind: 'text', nullable: true, maxLength: 2000, hint: LINK_HINT },
    { name: 'heroImageUrl', label: 'Main photo link', kind: 'text', nullable: true, maxLength: 2000, hint: LINK_HINT },
    { name: 'internalNotes', label: 'Staff notes', kind: 'textarea', nullable: true, hint: 'Never shown on the public site.' },
  ]
}

export const INDIA_FIELDS: FieldDef[] = [
  { name: 'india.nmcRecognised', label: 'Recognised by NMC', kind: 'select', nullable: true, options: YES_NO, emptyLabel: NOT_CHECKED, value: (r) => triState(india(r)?.nmcRecognised) },
  { name: 'india.nmcRecognitionCheckedAt', label: 'NMC recognition checked on', kind: 'date', nullable: true, noFuture: true, value: (r) => india(r)?.nmcRecognitionCheckedAt },
  { name: 'india.mbbsSeats', label: 'MBBS seats', kind: 'number', nullable: true, min: 0, value: (r) => india(r)?.mbbsSeats },
  { name: 'india.hospitalName', label: 'Teaching hospital', kind: 'text', nullable: true, maxLength: 300, value: (r) => india(r)?.hospitalName },
  { name: 'india.hospitalBeds', label: 'Hospital beds', kind: 'number', nullable: true, min: 0, value: (r) => india(r)?.hospitalBeds },
  { name: 'india.dailyOutpatients', label: 'Outpatients per day', kind: 'number', nullable: true, min: 0, value: (r) => india(r)?.dailyOutpatients },
  { name: 'india.serviceBondYears', label: 'Service bond (years)', kind: 'number', nullable: true, min: 0, hint: '0 or empty if there is none.', value: (r) => india(r)?.serviceBondYears },
  { name: 'india.serviceBondPenaltyInr', label: 'Bond penalty (₹)', kind: 'number', nullable: true, min: 0, value: (r) => india(r)?.serviceBondPenaltyInr },
  { name: 'india.stipendInr', label: 'Internship stipend per month (₹)', kind: 'number', nullable: true, min: 0, value: (r) => india(r)?.stipendInr },
  { name: 'india.domicileRule', label: 'Who qualifies for state-quota seats', kind: 'textarea', nullable: true, value: (r) => india(r)?.domicileRule },
]

/** Abroad fields shown before the intake-month checkboxes. */
export const ABROAD_FIELDS: FieldDef[] = [
  {
    name: 'abroad.wdomsListed',
    label: 'WDOMS listing',
    kind: 'select',
    required: true,
    options: [
      { value: 'LISTED', label: 'Listed in WDOMS' },
      { value: 'NOT_LISTED', label: 'Not listed in WDOMS' },
      { value: 'UNKNOWN', label: NOT_CHECKED },
    ],
    value: (r) => abroad(r)?.wdomsListed ?? 'UNKNOWN',
  },
  { name: 'abroad.wdomsId', label: 'WDOMS ID', kind: 'text', nullable: true, maxLength: 60, value: (r) => abroad(r)?.wdomsId },
  { name: 'abroad.wdomsUrl', label: 'WDOMS link', kind: 'text', nullable: true, maxLength: 2000, hint: LINK_HINT, value: (r) => abroad(r)?.wdomsUrl },
  { name: 'abroad.wdomsCheckedAt', label: 'WDOMS checked on', kind: 'date', nullable: true, noFuture: true, value: (r) => abroad(r)?.wdomsCheckedAt },
  { name: 'abroad.internshipMonths', label: 'Internship (months)', kind: 'number', nullable: true, min: 0, max: 60, value: (r) => abroad(r)?.internshipMonths },
  { name: 'abroad.teachingLanguage', label: 'Teaching language', kind: 'text', nullable: true, maxLength: 60, hint: 'e.g. English', value: (r) => abroad(r)?.teachingLanguage },
  { name: 'abroad.languageNote', label: 'Language note', kind: 'text', nullable: true, maxLength: 300, hint: 'e.g. Russian from year 3', value: (r) => abroad(r)?.languageNote },
  { name: 'abroad.seatsForIndians', label: 'Seats for Indian students', kind: 'number', nullable: true, min: 0, value: (r) => abroad(r)?.seatsForIndians },
]

/** Abroad fields shown after the intake-month checkboxes. */
export const ABROAD_MORE_FIELDS: FieldDef[] = [
  { name: 'abroad.nmcLengthOk', label: 'Course length meets NMC 2021 rules', kind: 'select', nullable: true, options: YES_NO, emptyLabel: NOT_CHECKED, value: (r) => triState(abroad(r)?.nmcLengthOk) },
  { name: 'abroad.nmcEnglishOk', label: 'Taught in English as NMC 2021 rules need', kind: 'select', nullable: true, options: YES_NO, emptyLabel: NOT_CHECKED, value: (r) => triState(abroad(r)?.nmcEnglishOk) },
  { name: 'abroad.nmcInternshipOk', label: 'Internship meets NMC 2021 rules', kind: 'select', nullable: true, options: YES_NO, emptyLabel: NOT_CHECKED, value: (r) => triState(abroad(r)?.nmcInternshipOk) },
  { name: 'abroad.nmcCheckedAt', label: 'NMC 2021 answers checked on', kind: 'date', nullable: true, noFuture: true, value: (r) => abroad(r)?.nmcCheckedAt },
  {
    name: 'abroad.eligibility',
    label: 'Eligibility',
    kind: 'textarea',
    nullable: true,
    hint: 'One rule per line as "Label: rule", e.g. "Age: 17 by 31 December".',
    value: (r) => eligibilityText(abroad(r)?.eligibility),
  },
  {
    name: 'abroad.documents',
    label: 'Documents needed',
    kind: 'textarea',
    hint: 'One document per line.',
    value: (r) => ((abroad(r)?.documents as string[] | undefined) ?? []).join('\n'),
  },
]

/** The name of the intake-month checkboxes (one per month, value 1 to 12). */
export const INTAKE = 'abroad.intakeMonths'

/** Every FieldDef-driven field of a college of this kind (intake months are handled apart). */
export const allFields = (kind: Kind): FieldDef[] => [
  ...commonFields(kind),
  ...(kind === 'INDIA' ? INDIA_FIELDS : [...ABROAD_FIELDS, ...ABROAD_MORE_FIELDS]),
]
