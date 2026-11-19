/* ================================================================
   STUDENTOS v7.6
   - effort reports now use a proper line graph (all sections)
   - clickable legend to toggle subject series
   - mini sparkline on dashboard summary
   ================================================================ */

const LS_CONFIG = 'studentos.config.v1';
const LS_SESSION = 'studentos.session.v1';
const LS_DATA = uid => `studentos.data.${uid}.v1`;
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/gmail.readonly'
];

const DEFAULT_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAWJ3DfVG0_4qtkbfx5Y6XVMQMKUdUxqWw",
    authDomain: "student-os-fb.firebaseapp.com",
    projectId: "student-os-fb",
    storageBucket: "student-os-fb.firebasestorage.app",
    messagingSenderId: "499752363180",
    appId: "1:499752363180:web:0ac024f9e242caac4cab09"
  }
};

const SACRED_HEART_CALENDAR = {
  id: 'sacred-heart',
  name: 'Sacred Heart College',
  url: 'https://kamar.sacredheart.school.kiwi/index.php/ics/school.ics'
};

const DEFAULT_SETTINGS = {
  theme: 'light',
  notifyNewAssignment: true,
  notifyDueSoon: true,
  notifyNewTest: true,
  onboardingSeen: false,
  emailLookbackDays: 30,
  trustedDomains: [],
  trustedSenders: [],
  emailKeywords: '',
  calendarSubscriptions: []
};

const SUBJECT_ALIASES = {
  'pe': 'PE & Health','p.e.': 'PE & Health','p.e': 'PE & Health','phys ed': 'PE & Health','physed': 'PE & Health',
  'physical education': 'PE & Health','physical education and health': 'PE & Health','physical ed': 'PE & Health',
  'pe & health': 'PE & Health','pe and health': 'PE & Health','pe/health': 'PE & Health','health': 'PE & Health',
  'health and physical education': 'PE & Health','hpe': 'PE & Health',
  'math': 'Mathematics','maths': 'Mathematics','mathematics': 'Mathematics','maths methods': 'Mathematics','mathematics methods': 'Mathematics',
  'english': 'English','eng': 'English',
  'science': 'Science','sci': 'Science',
  'biology': 'Biology','bio': 'Biology',
  'chemistry': 'Chemistry','chem': 'Chemistry',
  'physics': 'Physics','phys': 'Physics',
  'history': 'History','hist': 'History',
  'geography': 'Geography','geo': 'Geography',
  'social studies': 'Social Studies','social science': 'Social Studies','social sciences': 'Social Studies','soc sci': 'Social Studies','sst': 'Social Studies',
  'economics': 'Economics','econ': 'Economics','eco': 'Economics',
  'accounting': 'Accounting','acc': 'Accounting','accnt': 'Accounting','acct': 'Accounting',
  'business': 'Business','business studies': 'Business','busn': 'Business',
  'commerce': 'Commerce',
  'media studies': 'Media Studies','media': 'Media Studies','med': 'Media Studies',
  'classical studies': 'Classical Studies','classics': 'Classical Studies','cla': 'Classical Studies',
  'art': 'Art','visual art': 'Art','visual arts': 'Art',
  'music': 'Music','mus': 'Music',
  'drama': 'Drama','dra': 'Drama',
  'dance': 'Dance',
  'ict': 'Digital Technology','computing': 'Digital Technology','computer science': 'Digital Technology',
  'computer studies': 'Digital Technology','digital technology': 'Digital Technology','digital tech': 'Digital Technology','digital technologies': 'Digital Technology',
  'dig': 'Digital Technology','dgt': 'Digital Technology','dtg': 'Digital Technology',
  'technology': 'Technology','tech': 'Technology','tec': 'Technology','hard materials': 'Technology','soft materials': 'Technology',
  'food technology': 'Food Technology','food tech': 'Food Technology',
  'graphics': 'Design','design': 'Design','dvc': 'Design',
  'te reo': 'Te Reo Maori','te reo maori': 'Te Reo Maori','te reo māori': 'Te Reo Maori','maori': 'Te Reo Maori','māori': 'Te Reo Maori',
  'mri': 'Te Reo Maori','mao': 'Te Reo Maori','trm': 'Te Reo Maori',
  'french': 'French','fre': 'French','spanish': 'Spanish','spa': 'Spanish',
  'german': 'German','ger': 'German','japanese': 'Japanese','jap': 'Japanese','chinese': 'Chinese',
  're': 'Religious Education','r.e.': 'Religious Education','religious education': 'Religious Education','religious ed': 'Religious Education','theology': 'Religious Education','rel': 'Religious Education',
  'stats': 'Statistics','statistics': 'Statistics',
  'homeroom': 'Homeroom','form class': 'Homeroom','tutor': 'Homeroom',
  'pastoral': 'Pastoral',
  'outdoor education': 'Outdoor Education','outdoor ed': 'Outdoor Education','out': 'Outdoor Education',
  'scholarship': 'Scholarship',
  'esol': 'ESOL','esl': 'ESOL',
  'reading': 'Reading','library': 'Library'
};
