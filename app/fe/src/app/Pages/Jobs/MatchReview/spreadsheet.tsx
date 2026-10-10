import {
  Box,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  VStack,
} from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { parse, unparse } from 'papaparse';
import { useRef, useState } from 'react';
import { PrimaryButton, QuietButton, studentName } from './components';
import { lookupStudents } from './mockIdrs';
import { Candidate, StudentStatus, suggestedCandidates, useReviewSession } from './reviewSession';

/*
 * PROTOTYPE: working through students to match in a spreadsheet. The
 * reviewer downloads every student with their file details and suggestions,
 * enters the matched student's unique ID in one column, and uploads it. The
 * app takes what it can: matches for students still to review, from a
 * suggestion or, for an ID IDRS didn't suggest, a student IDRS confirms it
 * has. Everything else is reported back, and nothing in the app is
 * overwritten.
 */

const ENTRY = 'Matched student unique ID (enter here)';
const RECORD = "Record ID (don't change)";

const statusText: Record<StudentStatus, string> = {
  'to-review': 'Needs review',
  ready: 'Match saved',
  reprocessing: 'Submitted',
  reprocessed: 'Submitted',
  'run-failed': 'Submitted, run failed',
  excluded: 'Excluded',
};

const text = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : Array.isArray(value)
    ? value
        .map((v) =>
          v && typeof v === 'object' && 'id_value' in v
            ? [v.id_type, v.id_value].filter(Boolean).join(' ')
            : text(v)
        )
        .filter(Boolean)
        .join(', ')
    : typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);

const lastName = (group: GetStudentInputDetailsDto) =>
  `${text(group.inputDetails.last_name)} ${text(group.inputDetails.first_name)}`.toLowerCase();

/** Header text compared loosely, so a header retyped or reformatted still counts. */
const loose = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

type Line = { row: number; name: string; message: string };

type Report =
  | { problem: string }
  | {
      saved: Line[];
      submitted: Line[];
      conflicts: Line[];
      notFound: Line[];
      unusable: Line[];
      unchanged: number;
      blank: number;
    };

export const SpreadsheetControls = () => {
  const { job, groups, statusOf, decisions, batchOf, roster, decide } = useReviewSession();
  const input = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  /** The ID the app has for a student now: a saved or submitted match. */
  const appMatch = (correlationId: string) => {
    const status = statusOf(correlationId);
    if (status === 'ready') {
      const decision = decisions.get(correlationId);
      return decision?.kind === 'match' ? decision.candidate.studentUniqueId : '';
    }
    if (status === 'reprocessing' || status === 'reprocessed' || status === 'run-failed') {
      return (
        batchOf(correlationId)?.items.find((it) => it.correlationId === correlationId)?.decision
          .candidate.studentUniqueId ?? ''
      );
    }
    return '';
  };

  const download = () => {
    const most = Math.max(0, ...groups.map((g) => suggestedCandidates(g).length));
    const rows = [...groups]
      .sort((a, b) => lastName(a).localeCompare(lastName(b)))
      .map((group) => {
        const row: Record<string, string> = {
          'First name': text(group.inputDetails.first_name),
          'Last name': text(group.inputDetails.last_name),
          'Birth date': text(group.inputDetails.birth_date),
          'Student IDs in the file': text(group.inputDetails.student_ids),
          [ENTRY]: appMatch(group.correlationId),
          'Status in Runway': statusText[statusOf(group.correlationId)],
        };
        const suggestions = suggestedCandidates(group);
        for (let i = 0; i < most; i++) {
          const s = suggestions[i];
          const n = i + 1;
          row[`Suggestion ${n}: student unique ID`] = s?.studentUniqueId ?? '';
          row[`Suggestion ${n}: name`] = s ? studentName(s.rosterDetails) : '';
          row[`Suggestion ${n}: birth date`] = s ? text(s.rosterDetails.birth_date) : '';
          row[`Suggestion ${n}: match score`] = s?.score != null ? String(s.score) : '';
        }
        row[RECORD] = group.correlationId;
        return row;
      });
    // A byte-order mark, so Excel reads names with accents correctly.
    const csv = '\ufeff' + unparse(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    // Characters some systems won't allow in a file name become dashes.
    const jobName = job.name
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    link.download = `${jobName ? `${jobName} - ` : ''}students to match (job ${job.id}).csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    if (!/\.csv$/i.test(file.name)) {
      setReport({
        problem: /\.xlsx?$/i.test(file.name)
          ? 'This is an Excel workbook. Save it as a CSV file (File › Save As › CSV) and upload that.'
          : 'Upload the spreadsheet as a CSV file, the format it was downloaded in.',
      });
      return;
    }
    const parsed = parse<Record<string, string>>((await file.text()).replace(/^\ufeff/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
    });
    const headers = parsed.meta.fields ?? [];
    const entryColumn = headers.find((h) =>
      loose(h).startsWith(loose('Matched student unique ID'))
    );
    const recordColumn = headers.find((h) => loose(h).startsWith(loose('Record ID')));
    if (!entryColumn || !recordColumn) {
      setReport({
        problem: `This spreadsheet is missing the "${
          entryColumn ? RECORD : ENTRY
        }" column. Download a fresh copy from this page, enter IDs in the "${ENTRY}" column, and leave the other columns as they are.`,
      });
      return;
    }

    const byId = new Map(groups.map((g) => [g.correlationId, g]));
    const saved: Line[] = [];
    const submitted: Line[] = [];
    const conflicts: Line[] = [];
    const notFound: Line[] = [];
    const unusable: Line[] = [];
    let unchanged = 0;
    let blank = 0;

    // Read every row first: the same record twice with different IDs is ambiguous.
    const entries = new Map<string, { row: number; id: string; clash: boolean }>();
    parsed.data.forEach((cells, index) => {
      const row = index + 2; // the header is row 1
      const record = (cells[recordColumn] ?? '').trim();
      const id = (cells[entryColumn] ?? '').trim();
      const group = byId.get(record);
      if (!group) {
        if (record || id) {
          unusable.push({
            row,
            name: [cells['First name'], cells['Last name']].filter(Boolean).join(' ') || 'A row',
            message: record
              ? "isn't a student in this job. Was it copied from another spreadsheet?"
              : `has no record ID, so we can't tell which student it's for.`,
          });
        }
        return;
      }
      const earlier = entries.get(record);
      if (earlier && earlier.id !== id) earlier.clash = true;
      else if (!earlier) entries.set(record, { row, id, clash: false });
    });

    // IDs IDRS didn't suggest are checked with IDRS, all at once.
    const toCheck = new Set<string>();
    for (const [record, { id, clash }] of entries) {
      const status = statusOf(record);
      const group = byId.get(record);
      if (!id || clash || !group || status !== 'to-review') continue;
      if (!suggestedCandidates(group).some((c) => c.studentUniqueId === id)) toCheck.add(id);
    }
    setChecking(toCheck.size);
    const found = toCheck.size ? await lookupStudents(roster, [...toCheck]) : new Map();
    setChecking(null);

    for (const [record, { row, id, clash }] of entries) {
      const group = byId.get(record);
      if (!group) continue;
      const name = studentName(group.inputDetails);
      const status = statusOf(record);
      const app = appMatch(record);
      if (clash) {
        unusable.push({
          row,
          name,
          message: 'appears more than once with different IDs. Neither was used.',
        });
      } else if (!id) {
        blank++;
      } else if (status === 'reprocessing' || status === 'reprocessed' || status === 'run-failed') {
        submitted.push({
          row,
          name,
          message:
            app === id
              ? `was already submitted with ${id}.`
              : `was already submitted with ${app}, so ${id} wasn't used. To correct a submitted match, contact support.`,
        });
      } else if (status === 'excluded') {
        conflicts.push({
          row,
          name,
          message: `is excluded in Runway, but the spreadsheet says ${id}. It stays excluded; undo the exclusion in Runway to match them.`,
        });
      } else if (status === 'ready') {
        if (app === id) unchanged++;
        else {
          conflicts.push({
            row,
            name,
            message: `has ${app} saved in Runway, but the spreadsheet says ${id}. Runway's match was kept; change it in Runway if the spreadsheet is right.`,
          });
        }
      } else {
        const suggested = suggestedCandidates(group).find((c) => c.studentUniqueId === id);
        const student = found.get(id);
        const candidate: Candidate | null =
          suggested ??
          (student
            ? {
                studentUniqueId: student.studentUniqueId,
                rosterDetails: student.rosterDetails,
                score: null,
                source: 'search',
              }
            : null);
        if (!candidate) {
          notFound.push({
            row,
            name,
            message: `has ${id}, which no student in your roster has. Check it for typos or a dropped leading zero.`,
          });
        } else {
          decide(record, { kind: 'match', candidate });
          saved.push({
            row,
            name,
            message: `matched to ${id}${suggested ? '' : ' (not one of the suggestions)'}.`,
          });
        }
      }
    }
    setReport({ saved, submitted, conflicts, notFound, unusable, unchanged, blank });
  };

  return (
    <>
      <HStack gap="100">
        <QuietButton size="sm" onClick={download}>
          ⇩ Download spreadsheet
        </QuietButton>
        <QuietButton size="sm" onClick={() => input.current?.click()}>
          ⇧ Upload spreadsheet
        </QuietButton>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </HStack>
      <Modal
        isOpen={checking !== null || report !== null}
        onClose={() => setReport(null)}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent bg="blue.700" color="blue.50">
          <ModalHeader>Spreadsheet upload</ModalHeader>
          <ModalBody>
            {checking !== null ? (
              <HStack gap="300" paddingY="300">
                <Spinner size="sm" color="blue.50" />
                <Box>
                  Checking {checking} {checking === 1 ? 'ID' : 'IDs'} that weren't suggested with
                  the identity service…
                </Box>
              </HStack>
            ) : report && 'problem' in report ? (
              <VStack alignItems="stretch" gap="200">
                <Box fontWeight="600">Nothing was changed.</Box>
                <Box>{report.problem}</Box>
              </VStack>
            ) : report ? (
              <ReportBody report={report} />
            ) : null}
          </ModalBody>
          <ModalFooter>
            <PrimaryButton isDisabled={checking !== null} onClick={() => setReport(null)}>
              Done
            </PrimaryButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

const ReportBody = ({ report }: { report: Exclude<Report, { problem: string }> }) => {
  const { saved, submitted, conflicts, notFound, unusable, unchanged, blank } = report;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <VStack alignItems="stretch" gap="400">
      <Box>
        {saved.length
          ? `Saved ${plural(
              saved.length,
              'new match',
              'new matches'
            )}. They're ready to submit with your other matches.`
          : 'No new matches were saved.'}{' '}
        <Box as="span" opacity="0.8">
          {[
            unchanged &&
              `${plural(unchanged, 'row already matched', 'rows already matched')} Runway`,
            blank && `${plural(blank, 'row had', 'rows had')} no ID`,
          ]
            .filter(Boolean)
            .join('; ')}
          {unchanged || blank ? '.' : ''}
        </Box>
      </Box>
      <Section title="Needs a look: Runway and the spreadsheet disagree" lines={conflicts} />
      <Section title="IDs not found in your roster" lines={notFound} />
      <Section title="Rows that couldn't be used" lines={unusable} />
      <Section title="Already submitted" lines={submitted} muted />
      <Section title="Saved" lines={saved} muted />
    </VStack>
  );
};

const Section = ({ title, lines, muted }: { title: string; lines: Line[]; muted?: boolean }) =>
  lines.length ? (
    <VStack alignItems="stretch" gap="100">
      <Box fontWeight="600" opacity={muted ? 0.8 : 1}>
        {title} ({lines.length})
      </Box>
      {lines.map((line) => (
        <Item key={`${line.row}-${line.name}`} line={line} muted={muted} />
      ))}
    </VStack>
  ) : null;

const Item = ({ line, muted }: { line: Line; muted?: boolean }) => (
  <HStack alignItems="baseline" gap="200" fontSize="0.9rem" opacity={muted ? 0.8 : 1}>
    <Box opacity="0.7" whiteSpace="nowrap" width="3.5rem">
      Row {line.row}
    </Box>
    <Box>
      <Box as="span" fontWeight="600">
        {line.name}
      </Box>{' '}
      {line.message}
    </Box>
  </HStack>
);
