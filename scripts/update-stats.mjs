#!/usr/bin/env node
/**
 * Regenerates assets/stats-light.svg and assets/stats-dark.svg with live
 * GitHub stats for the current year:
 *   - Total contributions (GraphQL contributionCalendar)
 *   - Current consecutive week streak (completed Sunday-based weeks)
 *   - New projects shipped (non-fork repos created this year)
 *
 * Requires env GITHUB_TOKEN with read access to the GitHub GraphQL API.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = 'mxggle';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { createdAt isFork }
    }
  }
}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
if (!res.ok) {
  console.error(`GraphQL request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { data, errors } = await res.json();
if (errors) {
  console.error('GraphQL errors:', JSON.stringify(errors, null, 2));
  process.exit(1);
}

const today = new Date();
const YEAR = today.getUTCFullYear();
const yearStart = new Date(Date.UTC(YEAR, 0, 1));
const yearEnd = new Date(Date.UTC(YEAR, 11, 31));

// --- Contributions -------------------------------------------------------
const calendar = data.user.contributionsCollection.contributionCalendar;
const totalContributions = calendar.totalContributions;

const daily = new Map(); // YYYY-MM-DD -> count
for (const week of calendar.weeks) {
  for (const d of week.contributionDays) {
    daily.set(d.date.slice(0, 10), d.contributionCount);
  }
}
const iso = (d) => d.toISOString().slice(0, 10);
let lastActive = null;
for (const [date, count] of daily) {
  if (count > 0 && (!lastActive || date > lastActive)) lastActive = date;
}

// --- Week streak (consecutive completed Sunday-start weeks with >=1 contribution)
const weeklyTotals = calendar.weeks.map((w) =>
  w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0),
);
// Drop the trailing in-progress week(s) whose days extend beyond today.
let lastCompleted = -1;
calendar.weeks.forEach((w, i) => {
  const weekStart = new Date(w.contributionDays[0].date);
  if (weekStart.getTime() <= today.getTime()) lastCompleted = i;
});
let streakWeeks = 0;
let firstStreakWeekIdx = -1;
for (let i = lastCompleted; i >= 0 && weeklyTotals[i] > 0; i--) {
  streakWeeks++;
  firstStreakWeekIdx = i;
}
const streakStart =
  firstStreakWeekIdx >= 0 ? new Date(calendar.weeks[firstStreakWeekIdx].contributionDays[0].date) : yearStart;
const streakEnd = streakWeeks > 0 && lastActive ? new Date(`${lastActive}T00:00:00Z`) : yearStart;

// --- New projects --------------------------------------------------------
const newProjects = data.user.repositories.nodes.filter((r) => {
  if (r.isFork) return false;
  const created = new Date(r.createdAt);
  return created >= yearStart && created <= yearEnd;
}).length;

// --- Rendering -----------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const fmtRange = (a, b) => `${fmtDay(a)} &#8211; ${fmtDay(b)}, ${YEAR}`;
const fmtNum = (n) => n.toLocaleString('en-US');

const THEMES = {
  light: {
    bg: '#ffffff',
    border: '#d0d7de',
    divider: '#d0d7de',
    accent: '#0969da',
    text: '#24292f',
    muted: '#57606a',
    track: '#eaeef2',
  },
  dark: {
    bg: '#0d1117',
    border: '#30363d',
    divider: '#21262d',
    accent: '#58a6ff',
    text: '#c9d1d9',
    muted: '#8b949e',
    track: '#21262d',
  },
};

const FONT = "'Segoe UI', Ubuntu, -apple-system, BlinkMacSystemFont, sans-serif";

function render(themeName) {
  const t = THEMES[themeName];
  // Progress ring: fraction of the year elapsed.
  const CIRC = 2 * Math.PI * 36; // r = 36 -> ~226
  const elapsed = Math.min(1, Math.max(0, (today - yearStart) / (yearEnd - yearStart)));
  const offset = Math.round(CIRC * (1 - elapsed));

  const stat = (x, value, label, sub) => `
   <text x='${x}' y='72' text-anchor='middle' dy='0.35em' fill='${t.accent}' font-family=${JSON.stringify(FONT)} font-weight='700' font-size='30'>${value}</text>
   <text x='${x}' y='128' text-anchor='middle' fill='${t.text}' font-family=${JSON.stringify(FONT)} font-weight='600' font-size='14'>${label}</text>
   <text x='${x}' y='150' text-anchor='middle' fill='${t.muted}' font-family=${JSON.stringify(FONT)} font-weight='400' font-size='11.5'>${sub}</text>`;

  return `<svg xmlns='http://www.w3.org/2000/svg' width='495' height='195' viewBox='0 0 495 195' role='img' aria-label='GitHub shipping stats'>
 <rect x='0.5' y='0.5' width='494' height='194' rx='6' fill='${t.bg}' stroke='${t.border}'/>
 <line x1='165' y1='30' x2='165' y2='165' stroke='${t.divider}' stroke-width='1'/>
 <line x1='330' y1='30' x2='330' y2='165' stroke='${t.divider}' stroke-width='1'/>
 ${stat(82.5, fmtNum(totalContributions), `Contributions in ${YEAR}`, fmtRange(yearStart, today))}
 <circle cx='247.5' cy='72' r='36' fill='none' stroke='${t.track}' stroke-width='5'/>
 <circle cx='247.5' cy='72' r='36' fill='none' stroke='${t.accent}' stroke-width='5' stroke-linecap='round' stroke-dasharray='${Math.round(CIRC)}' stroke-dashoffset='${offset}' transform='rotate(-90 247.5 72)'/>
 ${stat(247.5, streakWeeks, 'Week Streak', `${fmtDay(streakStart)} &#8211; ${fmtDay(streakEnd)}`)}
 ${stat(412.5, newProjects, 'New Projects', `shipped in ${YEAR}`)}
</svg>
`;
}

writeFileSync(join(ROOT, 'assets/stats-light.svg'), render('light'));
writeFileSync(join(ROOT, 'assets/stats-dark.svg'), render('dark'));

console.log(
  `Updated stats: ${totalContributions} contributions · ${streakWeeks}-week streak (${iso(streakStart)} → ${iso(streakEnd)}) · ${newProjects} new projects`,
);
