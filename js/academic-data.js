/* Sacred Heart College curriculum reference data for Scribe.
 * Junior-school information is deliberately limited to the learning areas
 * the College publicly identifies; the 2027 handbook begins at Year 9.
 */
export const JUNIOR_LEARNING_AREAS = [
  'Core learning (homeroom programme)',
  'Performing and Visual Arts',
  'Technology',
  'Languages: Spanish, Chinese and Te Reo Māori',
  'Science',
  'Physical Education and Health',
  'Instrument programme (Years 7–8)'
];

export const CURRICULUM = {
  9: {
    compulsory: ['English', 'Health', 'Mathematics', 'Physical Education', 'Religious Education', 'Science', 'Social Studies', 'Digital Technologies'],
    options: ['Arts / Music (combined)', 'Chinese', 'Spanish', 'Te Reo Māori', 'Sports Institute (if selected)', 'Music Institute (if accepted)'],
    selectionNote: 'Students take the compulsory subjects and select two options. Arts/Music is a combined course; Sports and Music Institute places are subject to selection.'
  },
  10: {
    compulsory: ['English / English as an Additional Language', 'Mathematics', 'Physical Education, Life Skills and Health', 'Religious Education', 'Science', 'Social Studies'],
    options: ['Art', 'Chinese', 'Commerce', 'Media and Drama', 'Music', 'Music Institute (if selected)', 'Spanish', 'STEAM', 'Sports Institute (if selected)', 'Te Reo Māori', 'Food and Processing Technology', 'Resistant Materials Technology', 'Computer Science', 'Product and Spatial Design (DVC)'],
    selectionNote: 'Students take the common compulsory curriculum and select three options. A maximum of two Technology options is permitted.'
  },
  11: {
    compulsory: ['English', 'English for Literacy', 'English as an Additional Language', 'Mathematics', 'Mathematics - Applied', 'Mathematics for Numeracy', 'Physical Education and Health', 'Religious Education', 'Science - Agricultural', 'Science - Biological', 'Science - Physical'],
    options: ['Accounting', 'Art', 'Business Studies', 'Carpentry', 'Chinese (Mandarin)', 'Computer Science', 'Design and Visual Communication', 'Drama', 'Economics', 'Geography', 'History', 'Hospitality and Catering', 'Mechanical Technology', 'Music', 'Spanish', 'Te Reo Māori'],
    selectionNote: 'Year 11 students take seven subjects: one English course, one Mathematics course, Physical Education and Health, Religious Education, one or two sciences, and two optional subjects.'
  },
  12: {
    compulsory: ['English', 'English for Literacy', 'English as an Additional Language', 'Religious Education'],
    options: ['Accounting', 'Agriculture and Horticulture', 'Art - Design', 'Art - Painting', 'Biology', 'Business Studies', 'Carpentry', 'Chemistry', 'Chinese (Mandarin)', 'Classical Studies', 'Computer Science', 'Design and Visual Communication', 'Drama', 'Economics', 'Geography', 'History', 'Hospitality and Catering', 'Mathematics - Applied', 'Mathematics - Calculus', 'Media Studies', 'Music', 'Photography', 'Physical Education', 'Physics', 'Spanish', 'Te Reo Māori'],
    selectionNote: 'Year 12 students take six subjects: one English course, Religious Education, and four optional subjects. Te Reo Māori may replace English with approval from the relevant Heads of Department.'
  },
  13: {
    compulsory: ['Religious Education'],
    options: ['Accounting', 'Agriculture and Horticulture', 'Art - Design', 'Art - Painting', 'Biology', 'Business Studies', 'Carpentry', 'Chemistry', 'Chinese (Mandarin)', 'Classical Studies', 'Computer Science', 'Design and Visual Communication', 'Drama', 'Economics', 'English', 'English as an Additional Language', 'English for University Entrance Literacy', 'Geography', 'History', 'Hospitality and Catering', 'Mathematics - Statistics', 'Mathematics - Calculus', 'Mathematics - Applied', 'Media Studies', 'Music', 'Photography', 'Physical Education', 'Physics', 'Spanish', 'Sports Leadership Studies', 'Te Reo Māori'],
    selectionNote: 'Year 13 students take six subjects: Religious Education and five optional subjects. Some students may take courses at other levels where appropriate.'
  }
};

// These are explicit course continuations or progressions shown in the 2027
// Academic Curriculum overview. They are pathways, not a complete admission
// prerequisites list; course entry criteria remain subject to the College.
export const DIRECT_PATHWAYS = [
  [9, 'English', 10, 'English / English as an Additional Language'],
  [9, 'Mathematics', 10, 'Mathematics'],
  [9, 'Science', 10, 'Science'],
  [9, 'Science', 10, 'STEAM'],
  [9, 'Social Studies', 10, 'Social Studies'],
  [9, 'Digital Technologies', 10, 'Computer Science'],
  [9, 'Arts / Music (combined)', 10, 'Art'],
  [9, 'Arts / Music (combined)', 10, 'Music'],
  [9, 'Chinese', 10, 'Chinese'],
  [9, 'Spanish', 10, 'Spanish'],
  [9, 'Te Reo Māori', 10, 'Te Reo Māori'],
  [10, 'English / English as an Additional Language', 11, 'English'],
  [10, 'Te Reo Māori', 11, 'Te Reo Māori'],
  [10, 'Spanish', 11, 'Spanish'],
  [10, 'Chinese', 11, 'Chinese (Mandarin)'],
  [10, 'Mathematics', 11, 'Mathematics'],
  [10, 'Science', 11, 'Science - Biological'],
  [10, 'Science', 11, 'Science - Physical'],
  [10, 'Science', 11, 'Science - Agricultural'],
  [10, 'Commerce', 11, 'Accounting'],
  [10, 'Commerce', 11, 'Economics'],
  [10, 'Commerce', 11, 'Business Studies'],
  [10, 'Social Studies', 11, 'Geography'],
  [10, 'Social Studies', 11, 'History'],
  [10, 'Media and Drama', 11, 'Drama'],
  [10, 'Music', 11, 'Music'],
  [10, 'Art', 11, 'Art'],
  [10, 'Computer Science', 11, 'Computer Science'],
  [10, 'Food and Processing Technology', 11, 'Hospitality and Catering'],
  [10, 'Resistant Materials Technology', 11, 'Carpentry'],
  [10, 'Resistant Materials Technology', 11, 'Mechanical Technology'],
  [10, 'Product and Spatial Design (DVC)', 11, 'Design and Visual Communication'],
  [11, 'Science - Biological', 12, 'Biology'],
  [11, 'Science - Physical', 12, 'Chemistry'],
  [11, 'Science - Physical', 12, 'Physics'],
  [11, 'Science - Agricultural', 12, 'Agriculture and Horticulture'],
  [11, 'Art', 12, 'Art - Design'],
  [11, 'Art', 12, 'Art - Painting'],
  [11, 'Art', 12, 'Photography'],
  [11, 'Mathematics', 12, 'Mathematics - Calculus'],
  [11, 'Mathematics - Applied', 12, 'Mathematics - Applied'],
  [11, 'English', 12, 'English'],
  [11, 'English for Literacy', 12, 'English for Literacy'],
  [11, 'English as an Additional Language', 12, 'English as an Additional Language'],
  [11, 'Religious Education', 12, 'Religious Education'],
  [11, 'Te Reo Māori', 12, 'Te Reo Māori'],
  [11, 'Spanish', 12, 'Spanish'],
  [11, 'Chinese (Mandarin)', 12, 'Chinese (Mandarin)'],
  [11, 'Drama', 12, 'Drama'],
  [11, 'Music', 12, 'Music'],
  [11, 'Accounting', 12, 'Accounting'],
  [11, 'Economics', 12, 'Economics'],
  [11, 'Business Studies', 12, 'Business Studies'],
  [11, 'Geography', 12, 'Geography'],
  [11, 'History', 12, 'History'],
  [11, 'Computer Science', 12, 'Computer Science'],
  [12, 'Biology', 13, 'Biology'],
  [12, 'Chemistry', 13, 'Chemistry'],
  [12, 'Physics', 13, 'Physics'],
  [12, 'Mathematics - Calculus', 13, 'Mathematics - Calculus'],
  [12, 'Mathematics - Applied', 13, 'Mathematics - Applied'],
  [12, 'English', 13, 'English'],
  [12, 'English for Literacy', 13, 'English for University Entrance Literacy'],
  [12, 'English as an Additional Language', 13, 'English as an Additional Language'],
  [12, 'Religious Education', 13, 'Religious Education'],
  [12, 'Drama', 13, 'Drama'],
  [12, 'Media Studies', 13, 'Media Studies'],
  [12, 'Classical Studies', 13, 'Classical Studies'],
  [12, 'Accounting', 13, 'Accounting'],
  [12, 'Economics', 13, 'Economics'],
  [12, 'Business Studies', 13, 'Business Studies'],
  [12, 'Geography', 13, 'Geography'],
  [12, 'History', 13, 'History'],
  [12, 'Computer Science', 13, 'Computer Science'],
  // Additional explicit continuations represented in the handbook matrix.
  [10, 'English / English as an Additional Language', 11, 'English as an Additional Language'],
  [10, 'Mathematics', 11, 'Mathematics - Applied'],
  [10, 'Mathematics', 11, 'Mathematics for Numeracy'],
  [10, 'Art', 11, 'Art'],
  [10, 'Computer Science', 11, 'Computer Science'],
  [11, 'Physical Education and Health', 12, 'Physical Education'],
  [11, 'Carpentry', 12, 'Carpentry'],
  [11, 'Hospitality and Catering', 12, 'Hospitality and Catering'],
  [11, 'Design and Visual Communication', 12, 'Design and Visual Communication'],
  [11, 'Computer Science', 12, 'Computer Science'],
  [11, 'Chinese (Mandarin)', 12, 'Chinese (Mandarin)'],
  [11, 'Spanish', 12, 'Spanish'],
  [11, 'Te Reo Māori', 12, 'Te Reo Māori'],
  [11, 'Geography', 12, 'Geography'],
  [11, 'History', 12, 'History'],
  [12, 'Agriculture and Horticulture', 13, 'Agriculture and Horticulture'],
  [12, 'Art - Design', 13, 'Art - Design'],
  [12, 'Art - Painting', 13, 'Art - Painting'],
  [12, 'Photography', 13, 'Photography'],
  [12, 'Business Studies', 13, 'Business Studies'],
  [12, 'Carpentry', 13, 'Carpentry'],
  [12, 'Chinese (Mandarin)', 13, 'Chinese (Mandarin)'],
  [12, 'Computer Science', 13, 'Computer Science'],
  [12, 'Design and Visual Communication', 13, 'Design and Visual Communication'],
  [12, 'Economics', 13, 'Economics'],
  [12, 'Geography', 13, 'Geography'],
  [12, 'History', 13, 'History'],
  [12, 'Hospitality and Catering', 13, 'Hospitality and Catering'],
  [12, 'Music', 13, 'Music'],
  [12, 'Physical Education', 13, 'Physical Education'],
  [12, 'Spanish', 13, 'Spanish'],
  [12, 'Te Reo Māori', 13, 'Te Reo Māori'],
  // Compulsory strands and continuations shown in the handbook's Year 9–13 overview.
  [9, 'Physical Education', 10, 'Physical Education, Life Skills and Health'],
  [9, 'Health', 10, 'Physical Education, Life Skills and Health'],
  [9, 'Religious Education', 10, 'Religious Education'],
  [9, 'Sports Institute (if selected)', 10, 'Sports Institute (if selected)'],
  [10, 'Physical Education, Life Skills and Health', 11, 'Physical Education and Health'],
  [10, 'Religious Education', 11, 'Religious Education'],
  [12, 'Mathematics - Calculus', 13, 'Mathematics - Statistics'],
  [12, 'Physical Education', 13, 'Sports Leadership Studies']
];

/* ── Years 7–8 ────────────────────────────────────────────────────────
 * The College does not publish grade cut-offs for entry to Year 9, so the
 * links below are learning-area continuations ("builds towards"), not
 * prerequisites. The one explicit link in the 2027 handbook is the Year 9
 * Music Institute, which "continues the work from the Year 7 & 8 compulsory
 * instrument programme".
 */
const J_CORE = 'Core learning (homeroom programme)';
const J_ARTS = 'Performing and Visual Arts';
const J_TECH = 'Technology';
const J_LANG = 'Languages: Spanish, Chinese and Te Reo Māori';
const J_SCI = 'Science';
const J_PE = 'Physical Education and Health';
const J_INST = 'Instrument programme (Years 7–8)';

export const JUNIOR_PATHWAYS = [
  [J_CORE, 'English'], [J_CORE, 'Mathematics'], [J_CORE, 'Social Studies'], [J_CORE, 'Religious Education'],
  [J_SCI, 'Science'],
  [J_TECH, 'Digital Technologies'],
  [J_ARTS, 'Arts / Music (combined)'],
  [J_INST, 'Arts / Music (combined)'], [J_INST, 'Music Institute (if accepted)'],
  [J_LANG, 'Chinese'], [J_LANG, 'Spanish'], [J_LANG, 'Te Reo Māori'],
  [J_PE, 'Physical Education'], [J_PE, 'Health'], [J_PE, 'Sports Institute (if selected)']
];

// Subjects a Year 7–8 student can record a result against. The homeroom core
// is split into its strands so results can be matched to Year 9 subjects.
export const JUNIOR_RESULT_SUBJECTS = [
  'English', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Technology',
  'Performing and Visual Arts', 'Music / Instrument programme', 'Languages', 'Physical Education and Health'
];

// What to aim for in Years 7–8 for each Year 9 subject. `track` lists the
// result subjects (see JUNIOR_RESULT_SUBJECTS) that count as evidence.
export const JUNIOR_TARGETS = [
  { subject: 'English', area: J_CORE, track: ['English'],
    aim: 'At or above the expected curriculum level in reading and writing.',
    prepare: 'Read widely, write in full paragraphs and practise explaining your ideas aloud.',
    extension: 'Strong Year 9 English (for example completing Reading Plus) is how students are invited into the Year 10 extension class, 10ENX.' },
  { subject: 'Mathematics', area: J_CORE, track: ['Mathematics'],
    aim: 'At or above the expected curriculum level in number, algebra, measurement and statistics.',
    prepare: 'Lock in times tables, fractions, decimals and percentages, and show your working.',
    extension: 'Students who complete an advanced Mathematics course in Year 9 may be invited to start the Sacred Heart Certificate early (10MAX).' },
  { subject: 'Science', area: J_SCI, track: ['Science'],
    aim: 'At or above the expected level in investigations and written explanations.',
    prepare: 'Practise fair testing, careful observation and explaining results with evidence.',
    extension: 'Strong Science results lead towards the Year 10 accelerate class, 10SCX.' },
  { subject: 'Social Studies', area: J_CORE, track: ['Social Studies'],
    aim: 'At or above the expected level in inquiry and written work.',
    prepare: 'Practise researching a question, using sources and writing a clear conclusion.' },
  { subject: 'Religious Education', area: J_CORE, track: ['Religious Education'],
    aim: 'Complete all work to the expected standard.',
    prepare: 'Religious Education is compulsory every year to Year 13, so steady effort now pays off.' },
  { subject: 'Physical Education', area: J_PE, track: ['Physical Education and Health'],
    aim: 'Full participation and effort.',
    prepare: 'Take part fully, try a range of activities and learn the rules of each.' },
  { subject: 'Health', area: J_PE, track: ['Physical Education and Health'],
    aim: 'Complete all work to the expected standard.',
    prepare: 'Join in discussions and finish written work on time.' },
  { subject: 'Digital Technologies', area: J_TECH, track: ['Technology'],
    aim: 'At or above the expected level in Technology projects.',
    prepare: 'Finish design projects, document your process and build confidence with digital tools.' },
  { subject: 'Arts / Music (combined)', option: true, area: J_ARTS, track: ['Performing and Visual Arts', 'Music / Instrument programme'],
    aim: 'Solid results and real interest in Art and Music.',
    prepare: 'Keep a sketchbook going and keep up your instrument. Year 9 Art is advantageous, and Year 9 Music essential, for taking those subjects in Year 10.' },
  { subject: 'Chinese', option: true, area: J_LANG, track: ['Languages'],
    aim: 'Solid results in your Chinese taster, especially speaking and listening.',
    prepare: 'Learn the vocabulary as you go. Taking Chinese in Year 9 is essential for Year 10 Chinese.' },
  { subject: 'Spanish', option: true, area: J_LANG, track: ['Languages'],
    aim: 'Solid results in your Spanish taster, especially speaking and listening.',
    prepare: 'Learn the vocabulary as you go. Taking Spanish in Year 9 is essential for Year 10 Spanish.' },
  { subject: 'Te Reo Māori', option: true, area: J_LANG, track: ['Languages'],
    aim: 'Solid results in Te Reo Māori, especially pronunciation and basic vocabulary.',
    prepare: 'Practise pronunciation and simple sentences. Taking Te Reo Māori in Year 9 is essential for Year 10.' },
  { subject: 'Music Institute (if accepted)', option: true, selective: true, area: J_INST, track: ['Music / Instrument programme'],
    aim: 'Strong progress on your instrument. Entry is by acceptance.',
    prepare: 'Keep taking lessons and play in a group. The Year 9 Music Institute continues the Year 7–8 instrument programme at an accelerated level.' },
  { subject: 'Sports Institute (if selected)', option: true, selective: true, area: J_PE, track: ['Physical Education and Health'],
    aim: 'Selection is by sporting code, not by grades.',
    prepare: 'Cricket, Football and Rugby run inside the timetable and count as one of your two options. Rowing, Water Polo and Basketball run outside school hours and do not.' }
];

/* ── Extension classes ("Exelerate") and Scholarship ──────────────────
 * The 2027 handbook does not use the name "Exelerate". It does describe
 * invitation-only extension / accelerate classes (ENX, MAX, SCX and the
 * Music Institute) and Scholarship courses. Scribe shows those as the
 * Exelerate strand. If the College defines Exelerate differently, edit
 * EXTENSION_COURSES and EXTENSION_PATHWAYS below; nothing else needs to change.
 */
export const EXTENSION_COURSES = {
  10: [
    { name: 'Extension English (10ENX)', kind: 'extension', entry: 'By Head of Department selection. Sacred Heart Certificate English a year early.' },
    { name: 'Advanced Mathematics (10MAX)', kind: 'extension', entry: 'By invitation, after an advanced Mathematics course in Year 9. Sacred Heart Certificate Mathematics a year early.' },
    { name: 'Accelerate Science (10SCX)', kind: 'extension', entry: 'By Head of Department selection. Sacred Heart Certificate Biological Science a year early; confirm the following year with the HOD Science.' }
  ],
  11: [
    { name: 'Extension English (11ENX)', kind: 'extension', entry: 'Successful completion of 10ENX.' },
    { name: 'Level 2 Calculus a year early (11MAX)', kind: 'extension', entry: 'Continues from 10MAX; taught with 12MAC. Accelerated students complete later levels ahead of their peers.' },
    { name: 'NCEA Level 2 Music a year early', kind: 'extension', entry: 'For Music Institute students who completed Sacred Heart Certificate Music in Year 10.' }
  ],
  12: [
    { name: 'Extension English (12ENX)', kind: 'extension', entry: 'Continues the extension programme from 10ENX and 11ENX; 55% in Sacred Heart Certificate English plus both literacy CAA standards.' },
    { name: 'Religious Studies with Scholarship (12RSS)', kind: 'scholarship', entry: 'Level 2 course that also covers Scholarship topics.' }
  ],
  13: [
    { name: 'English Scholarship (13ESS)', kind: 'scholarship', entry: 'Head of Department selection. Aimed at students who completed the ENX programme or showed a high degree of competence in Year 12 English.' },
    { name: 'Chemistry for Scholarship (13CSS)', kind: 'scholarship', entry: 'Merit or Excellence in both Level 2 Chemistry internals, all externals passed with Excellence in at least two.' },
    { name: 'Physics for Scholarship (13PES)', kind: 'scholarship', entry: 'Three Merit passes or better in the Level 2 Physics externals; Mathematics to Level 2.' },
    { name: 'Biology for Scholarship (13BSS)', kind: 'scholarship', entry: 'Merit or better in both Level 2 Biology internals (AS91153, AS91158).' },
    { name: 'Religious Studies with Scholarship (13RSS)', kind: 'scholarship', entry: 'Completion of the Year 12 Religious Education course.' }
  ]
};

export const EXTENSION_PATHWAYS = [
  [9, 'English', 10, 'Extension English (10ENX)'],
  [9, 'Mathematics', 10, 'Advanced Mathematics (10MAX)'],
  [9, 'Science', 10, 'Accelerate Science (10SCX)'],
  [9, 'Music Institute (if accepted)', 10, 'Music Institute (if selected)'],
  [10, 'Extension English (10ENX)', 11, 'Extension English (11ENX)'],
  [10, 'Advanced Mathematics (10MAX)', 11, 'Level 2 Calculus a year early (11MAX)'],
  [10, 'Music Institute (if selected)', 11, 'NCEA Level 2 Music a year early'],
  [11, 'Extension English (11ENX)', 12, 'Extension English (12ENX)'],
  [11, 'NCEA Level 2 Music a year early', 12, 'Music'],
  [11, 'Religious Education', 12, 'Religious Studies with Scholarship (12RSS)'],
  [12, 'Extension English (12ENX)', 13, 'English Scholarship (13ESS)'],
  [12, 'English', 13, 'English Scholarship (13ESS)'],
  [12, 'Chemistry', 13, 'Chemistry for Scholarship (13CSS)'],
  [12, 'Physics', 13, 'Physics for Scholarship (13PES)'],
  [12, 'Biology', 13, 'Biology for Scholarship (13BSS)'],
  [12, 'Religious Studies with Scholarship (12RSS)', 13, 'Religious Studies with Scholarship (13RSS)'],
  [12, 'Religious Education', 13, 'Religious Studies with Scholarship (13RSS)']
];

// Year 13 subjects where the handbook mentions a Scholarship exam, portfolio
// or programme. The College runs Scholarship "across most Level 3 subjects";
// teachers recommend entry, usually in Years 12 and 13.
export const SCHOLARSHIP_SUBJECTS = [
  'Accounting', 'Agriculture and Horticulture', 'Art - Design', 'Art - Painting', 'Biology', 'Chemistry',
  'Chinese (Mandarin)', 'Classical Studies', 'Drama', 'Economics', 'English', 'Mathematics - Calculus',
  'Mathematics - Statistics', 'Media Studies', 'Music', 'Photography', 'Physical Education', 'Physics',
  'Religious Education', 'Spanish', 'Te Reo Māori'
];

/* ── Published entry criteria (2027 handbook) ─────────────────────────
 * Key: "<year>|<subject>". `min` is a percentage the handbook asks for in
 * the listed earlier subject(s); Scribe compares it with saved results.
 * Students who miss a criterion can still apply for HOD approval.
 */
export const ENTRY_CRITERIA = {
  '11|Accounting': { text: 'At least an Achieved grade in Year 10 Commerce.' },
  '11|Economics': { text: 'At least a passing grade in Year 10 English; Achieved in Year 10 Commerce is an advantage.' },
  '11|Business Studies': { text: 'At least Achieved in Year 10 English; Achieved in Year 10 Commerce is an advantage.' },
  '11|Art': { text: 'Completed Year 10 Art, or at the discretion of the HOD.' },
  '11|Mathematics': { text: 'Head of Department selection.' },
  '11|Mathematics - Applied': { text: 'Achieved in most Year 10 Mathematics assessments, or HOD selection.' },
  '11|Mathematics for Numeracy': { text: 'HOD selection; designed for students who find Mathematics very challenging.' },
  '11|English': { text: 'Head of Department selection into one of the two English courses.' },
  '11|Science - Physical': { text: 'Merit in the Physical World and Material World sections of the Year 10 Science exam, and at least Achieved in Year 10 Mathematics.' },
  '11|Science - Biological': { text: 'Completion of Year 10 Science.' },
  '11|Science - Agricultural': { text: 'Completion of Year 10 Science.' },
  '11|Te Reo Māori': { text: 'Year 10 Te Reo Māori gives automatic entry; otherwise by interview.' },
  '11|Spanish': { text: 'Year 10 Spanish with Achieved in all four skills in the end-of-year exams.' },
  '11|Chinese (Mandarin)': { text: 'Year 10 Chinese with Achieved in all four skills in the end-of-year exams.' },
  '11|Music': { text: 'Year 10 Music or equivalent evidence; you must already play an instrument and continue lessons.' },
  '11|Geography': { text: 'Teacher judgement based on Year 10 performance.' },
  '11|History': { text: 'No entry requirement.' },
  '11|Drama': { text: 'No minimum requirement; commitment to group work and rehearsals is expected.' },
  '11|Computer Science': { text: 'No minimum requirement; Year 10 Maths grades are used if the course is oversubscribed.' },
  '11|Design and Visual Communication': { text: 'No minimum requirement; Year 10 DVC students get priority if oversubscribed.' },
  '11|Hospitality and Catering': { text: 'None, but Year 10 Food Technology is preferred.' },
  '11|Carpentry': { text: 'None, but Year 10 Resistant Materials is preferred.' },
  '11|Mechanical Technology': { text: 'No minimum requirement, but Year 10 Resistant Materials is preferred.' },
  '12|English': { text: '55% in Sacred Heart Certificate English plus both literacy CAA standards (65% average for the 12ENG course).', min: 55, from: ['English'] },
  '12|Mathematics - Calculus': { text: '65% or above in Sacred Heart Certificate Mathematics.', min: 65, from: ['Mathematics'] },
  '12|Mathematics - Applied': { text: '50% or above in Sacred Heart Certificate Mathematics.', min: 50, from: ['Mathematics', 'Mathematics - Applied'] },
  '12|Biology': { text: '55% in Sacred Heart Certificate Biological Science or Agricultural and Horticultural Science.', min: 55, from: ['Science - Biological', 'Science - Agricultural'] },
  '12|Chemistry': { text: '55% in Sacred Heart Certificate Biological or Physical Science.', min: 55, from: ['Science - Physical', 'Science - Biological'] },
  '12|Physics': { text: '55% in Sacred Heart Certificate Physical Science and 55% in Sacred Heart Certificate algebra.', min: 55, from: ['Science - Physical'] },
  '12|Agriculture and Horticulture': { text: '50% in Sacred Heart Certificate Agricultural Science, or 55% in Biological or Physical Science.', min: 50, from: ['Science - Agricultural'] },
  '12|Accounting': { text: '50% in Sacred Heart Certificate Accounting.', min: 50, from: ['Accounting'] },
  '12|Economics': { text: '50% in Sacred Heart Certificate Economics, or 50% in both English and Mathematics.', min: 50, from: ['Economics'] },
  '12|Business Studies': { text: '50% in Sacred Heart Certificate Business Studies.', min: 50, from: ['Business Studies'] },
  '12|Art - Design': { text: '50% in the Sacred Heart Certificate, or a portfolio of DVC and ICT work.', min: 50, from: ['Art'] },
  '12|Art - Painting': { text: '50% in Sacred Heart Certificate Art.', min: 50, from: ['Art'] },
  '12|Photography': { text: '50% in Sacred Heart Certificate Art.', min: 50, from: ['Art'] },
  '12|Media Studies': { text: '55% in Sacred Heart Certificate English plus both literacy CAA standards.', min: 55, from: ['English'] },
  '12|Drama': { text: '55% in Sacred Heart Certificate English plus both literacy CAA standards.', min: 55, from: ['English'] },
  '12|Classical Studies': { text: '55% in Sacred Heart Certificate English and/or History.', min: 55, from: ['English', 'History'] },
  '12|Te Reo Māori': { text: '50% in Sacred Heart Certificate Te Reo Māori, or a Māori-speaking background.', min: 50, from: ['Te Reo Māori'] },
  '12|Spanish': { text: '50% in Sacred Heart Certificate Spanish, or a fluent-speaking home.', min: 50, from: ['Spanish'] },
  '12|Chinese (Mandarin)': { text: '50% in Sacred Heart Certificate Chinese.', min: 50, from: ['Chinese (Mandarin)'] },
  '12|Music': { text: '50% in Sacred Heart Certificate Music, or prior formal training at HOD discretion.', min: 50, from: ['Music'] },
  '12|Physical Education': { text: 'Open entry (Physical Education A).' },
  '12|Geography': { text: '50% across all assessments in the Sacred Heart Certificate.', min: 50, from: ['Geography'] },
  '12|History': { text: '50% across all assessments in Sacred Heart Certificate History.', min: 50, from: ['History'] },
  '12|Hospitality and Catering': { text: '50% in Sacred Heart Certificate Hospitality, or an interest in a hospitality career.', min: 50, from: ['Hospitality and Catering'] },
  '12|Carpentry': { text: '50% in Sacred Heart Certificate Carpentry or Mechanical Technology.', min: 50, from: ['Carpentry', 'Mechanical Technology'] },
  '12|Computer Science': { text: '65% in Sacred Heart Certificate Computer Science, or 65% in Mathematics (Algebra and Number) for new learners.', min: 65, from: ['Computer Science', 'Mathematics'] },
  '12|Design and Visual Communication': { text: '50% in Sacred Heart Certificate DVC.', min: 50, from: ['Design and Visual Communication'] },
  '13|English': { text: 'Level 2 English with at least four Merit or Excellence credits from externals (13ENG); Level 2 literacy met.' },
  '13|Mathematics - Calculus': { text: 'Merit or above in Level 2 Algebra, Graphs and Calculus.' },
  '13|Mathematics - Statistics': { text: 'At least 12 credits in 12MAC; Level 2 literacy required.' },
  '13|Mathematics - Applied': { text: 'From 12MAT: 14 credits including Probability and Inference, six at Merit or higher, with teacher recommendation.' },
  '13|Biology': { text: 'Merit or better in both Level 2 Biology internals (AS91153, AS91158).' },
  '13|Chemistry': { text: 'Merit in both Level 2 Chemistry internals and in all three externals; Mathematics to Level 2.' },
  '13|Physics': { text: 'Merit in AS91173 and Achieved in AS91168 and AS91171; Mathematics to Level 2.' },
  '13|Agriculture and Horticulture': { text: '14 credits in Level 2 Agricultural Science or Level 2 Economics.' },
  '13|Accounting': { text: '14 credits in Level 2 Accounting, or 16 credits in both English and Mathematics with 10 at Merit or Excellence.' },
  '13|Economics': { text: '12 credits in Level 2 Economics including two externals.' },
  '13|Business Studies': { text: '14 credits in Level 2 Business Studies including at least one external.' },
  '13|Art - Design': { text: '16 credits in Level 2 Art, or a portfolio.' },
  '13|Art - Painting': { text: 'Level 2 Painting at Achieved level.' },
  '13|Photography': { text: '16 credits in Level 2 Photography for the full course.' },
  '13|Media Studies': { text: 'At least 13 credits in Level 2 Media Studies.' },
  '13|Drama': { text: 'Eight credits in the Level 2 Drama externals, four at Merit or Excellence.' },
  '13|Classical Studies': { text: 'Sufficient external credits in English and/or History.' },
  '13|Te Reo Māori': { text: 'Achieved in at least 10 Level 2 Te Reo Māori credits.' },
  '13|Spanish': { text: 'Achieved in Level 2 Spanish.' },
  '13|Chinese (Mandarin)': { text: '14 Level 2 credits, at least five from externals.' },
  '13|Music': { text: 'Level 2 Music gives automatic entry.' },
  '13|Physical Education': { text: '15 credits in Level 2 Physical Education.' },
  '13|Sports Leadership Studies': { text: '14 credits in Level 2 Physical Education or Sports Science.' },
  '13|Geography': { text: 'Achieved in all Level 2 Geography assessments.' },
  '13|History': { text: 'Achieved across all Level 2 History assessments.' },
  '13|Hospitality and Catering': { text: 'US 167 and five or more Level 2 Hospitality unit standards.' },
  '13|Carpentry': { text: 'A pass in Year 12 Carpentry.' },
  '13|Computer Science': { text: '14 credits in Level 2 Computer Science, or Merit/Excellence in Level 2 Mathematics for new learners.' },
  '13|Design and Visual Communication': { text: '14 credits in Level 2 DVC.' }
};

const ALL_PATHWAYS = [
  ...JUNIOR_LEARNING_AREAS.map(area => [7, area, 8, area]),
  ...JUNIOR_PATHWAYS.map(([area, subject]) => [8, area, 9, subject]),
  ...DIRECT_PATHWAYS,
  ...EXTENSION_PATHWAYS
];

export function entryCriteriaFor(year, subject) {
  const ext = (EXTENSION_COURSES[Number(year)] || []).find(x => x.name === subject);
  if (ext) return { text: ext.entry };
  return ENTRY_CRITERIA[`${Number(year)}|${subject}`] || null;
}

/** Every node on the course map for one year level. */
export function nodesForYear(year) {
  const y = Number(year);
  if (y <= 8) return JUNIOR_LEARNING_AREAS.map(name => ({ year: y, name, type: 'foundation' }));
  const data = CURRICULUM[y];
  if (!data) return [];
  return [
    ...data.compulsory.map(name => ({ year: y, name, type: 'core' })),
    ...data.options.map(name => ({ year: y, name, type: 'option' })),
    ...(EXTENSION_COURSES[y] || []).map(x => ({ year: y, name: x.name, type: x.kind }))
  ];
}

export function successorsFor(year, subject) {
  return [...new Set(ALL_PATHWAYS
    .filter(([fromYear, from]) => fromYear === Number(year) && from === subject)
    .map(([, , , to]) => to))];
}

/** Keys ("year|subject") of everything linked to a node, backwards and forwards. */
export function pathwayChain(year, subject) {
  const key = (y, s) => `${y}|${s}`;
  const seen = new Set([key(Number(year), subject)]);
  const walk = (y, s, forward) => {
    const next = forward
      ? ALL_PATHWAYS.filter(p => p[0] === y && p[1] === s).map(p => [p[2], p[3]])
      : ALL_PATHWAYS.filter(p => p[2] === y && p[3] === s).map(p => [p[0], p[1]]);
    for (const [ny, ns] of next) {
      const k = key(ny, ns);
      if (seen.has(k)) continue;
      seen.add(k);
      walk(ny, ns, forward);
    }
  };
  walk(Number(year), subject, true);
  walk(Number(year), subject, false);
  return seen;
}

/** Keys of every later subject reachable by direct pathways from the given subjects. */
export function reachableFrom(year, subjects) {
  const out = new Set();
  const walk = (y, s) => {
    for (const p of ALL_PATHWAYS) {
      if (p[0] !== y || p[1] !== s) continue;
      const k = `${p[2]}|${p[3]}`;
      if (out.has(k)) continue;
      out.add(k);
      walk(p[2], p[3]);
    }
  };
  for (const s of subjects || []) walk(Number(year), s);
  return out;
}

export function subjectsForYear(year) {
  const y = Number(year);
  if (y <= 8) return [...JUNIOR_LEARNING_AREAS];
  const data = CURRICULUM[y];
  return data ? [...data.compulsory, ...data.options] : [];
}

export function defaultSubjectsForYear(year) {
  const y = Number(year);
  if (y <= 8) return [...JUNIOR_LEARNING_AREAS];
  if (y === 9) return [...CURRICULUM[9].compulsory];
  if (y === 10) return [...CURRICULUM[10].compulsory];
  return [];
}

export function predecessorsFor(year, subject) {
  return [...new Set(ALL_PATHWAYS
    .filter(([fromYear, , toYear, to]) => toYear === Number(year) && to === subject)
    .map(([, from, ,]) => from))];
}
