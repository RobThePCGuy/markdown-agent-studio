import type { StreamChunk } from '../types';
import type { ScriptMap } from './scripted-provider';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function text(t: string): StreamChunk {
  return { type: 'text', text: t };
}

function tc(id: string, name: string, args: Record<string, unknown>): StreamChunk {
  return { type: 'tool_call', toolCall: { id, name, args } };
}

function done(tokens: number): StreamChunk {
  return { type: 'done', tokenCount: tokens };
}

// ---------------------------------------------------------------------------
// Content constants -- kept out of the script map for readability
// ---------------------------------------------------------------------------

const DESIGN_SPEC = `# Portfolio Website Design Specification

## Layout
- Single-page scrolling layout with fixed navigation header
- Sections: Hero, About, Projects, Skills, Contact, Footer
- Max content width: 1100px, centered with auto margins
- Section padding: 80px vertical on desktop, 48px on mobile

## Color Palette (Dark Theme)
- Background primary: #0f172a (slate-900)
- Background secondary: #1e293b (slate-800)
- Surface: #334155 (slate-700)
- Text primary: #f8fafc (slate-50)
- Text secondary: #94a3b8 (slate-400)
- Accent: #38bdf8 (sky-400)
- Accent hover: #7dd3fc (sky-300)
- Success: #4ade80 (green-400)

## Typography
- Headings: "Inter", sans-serif -- weights 600 and 700
- Body: "Inter", sans-serif -- weight 400, line-height 1.6
- Hero title: clamp(2.5rem, 5vw, 4rem)
- Section titles: 2rem
- Body text: 1rem / 1.125rem

## Components
- **Nav**: Sticky top bar, logo left, links right, backdrop blur
- **Hero**: Full-viewport height, centered text, subtle gradient overlay
- **Project Cards**: 3-column grid (1-col mobile), rounded corners, hover lift
- **Skills**: Tag-pill layout with subtle borders
- **Contact**: Centered CTA with mailto link styled as button
- **Footer**: Minimal, centered copyright text
`;

const PORTFOLIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Alex Morgan - Full-Stack Developer Portfolio" />
  <title>Alex Morgan | Full-Stack Developer</title>
  <link rel="stylesheet" href="styles.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <!-- Navigation -->
  <header class="nav" role="banner">
    <nav class="nav__inner" aria-label="Primary navigation">
      <a href="#hero" class="nav__logo">AM</a>
      <ul class="nav__links" role="list">
        <li><a href="#about">About</a></li>
        <li><a href="#projects">Projects</a></li>
        <li><a href="#skills">Skills</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <!-- Hero Section -->
    <section id="hero" class="hero" aria-labelledby="hero-heading">
      <div class="hero__content">
        <p class="hero__greeting">Hi, I'm</p>
        <h1 id="hero-heading" class="hero__title">Alex Morgan</h1>
        <p class="hero__tagline">Full-stack developer crafting fast, accessible, and beautiful web experiences.</p>
        <a href="#projects" class="hero__cta">View My Work</a>
      </div>
    </section>

    <!-- About Section -->
    <section id="about" class="section about" aria-labelledby="about-heading">
      <div class="container">
        <h2 id="about-heading" class="section__title">About Me</h2>
        <p class="about__text">
          I'm a full-stack developer with 6 years of experience building products
          that people love to use. I specialize in React, TypeScript, and Node.js,
          with a strong focus on performance and accessibility. When I'm not coding,
          you'll find me contributing to open-source projects or writing about web
          development on my blog.
        </p>
      </div>
    </section>

    <!-- Projects Section -->
    <section id="projects" class="section projects" aria-labelledby="projects-heading">
      <div class="container">
        <h2 id="projects-heading" class="section__title">Featured Projects</h2>
        <div class="projects__grid" role="list">
          <article class="project-card" role="listitem">
            <div class="project-card__header">
              <h3 class="project-card__title">TaskFlow</h3>
              <span class="project-card__tag">SaaS</span>
            </div>
            <p class="project-card__desc">
              A real-time project management app with drag-and-drop Kanban boards,
              team collaboration, and automated workflow triggers.
            </p>
            <ul class="project-card__tech" aria-label="Technologies used">
              <li>React</li>
              <li>TypeScript</li>
              <li>PostgreSQL</li>
            </ul>
          </article>

          <article class="project-card" role="listitem">
            <div class="project-card__header">
              <h3 class="project-card__title">Pulsemap</h3>
              <span class="project-card__tag">Data Viz</span>
            </div>
            <p class="project-card__desc">
              An interactive heatmap dashboard for monitoring server metrics,
              featuring WebSocket streaming and custom D3.js visualizations.
            </p>
            <ul class="project-card__tech" aria-label="Technologies used">
              <li>D3.js</li>
              <li>Node.js</li>
              <li>Redis</li>
            </ul>
          </article>

          <article class="project-card" role="listitem">
            <div class="project-card__header">
              <h3 class="project-card__title">Lingua</h3>
              <span class="project-card__tag">AI/ML</span>
            </div>
            <p class="project-card__desc">
              A language-learning platform powered by spaced repetition and NLP,
              with voice recognition for pronunciation practice.
            </p>
            <ul class="project-card__tech" aria-label="Technologies used">
              <li>Python</li>
              <li>FastAPI</li>
              <li>TensorFlow</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <!-- Skills Section -->
    <section id="skills" class="section skills" aria-labelledby="skills-heading">
      <div class="container">
        <h2 id="skills-heading" class="section__title">Skills</h2>
        <ul class="skills__list" role="list" aria-label="Technical skills">
          <li class="skill-pill">TypeScript</li>
          <li class="skill-pill">React</li>
          <li class="skill-pill">Node.js</li>
          <li class="skill-pill">Python</li>
          <li class="skill-pill">PostgreSQL</li>
          <li class="skill-pill">GraphQL</li>
          <li class="skill-pill">Docker</li>
          <li class="skill-pill">AWS</li>
          <li class="skill-pill">Figma</li>
          <li class="skill-pill">Git</li>
          <li class="skill-pill">CI/CD</li>
          <li class="skill-pill">Accessibility</li>
        </ul>
      </div>
    </section>

    <!-- Contact Section -->
    <section id="contact" class="section contact" aria-labelledby="contact-heading">
      <div class="container">
        <h2 id="contact-heading" class="section__title">Get In Touch</h2>
        <p class="contact__text">
          I'm currently open to freelance projects and full-time opportunities.
          If you have an idea you'd like to bring to life, let's talk.
        </p>
        <a href="mailto:alex@example.com" class="contact__btn" aria-label="Send email to Alex Morgan">
          Say Hello
        </a>
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="footer" role="contentinfo">
    <p>&copy; 2026 Alex Morgan. Built with care.</p>
  </footer>
</body>
</html>`;

const PORTFOLIO_CSS = `/* ============================================================
   Portfolio Stylesheet - Dark Theme
   ============================================================ */

/* ----- Custom Properties ----- */
:root {
  /* Colors */
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-surface: #334155;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #94a3b8;
  --color-accent: #38bdf8;
  --color-accent-hover: #7dd3fc;
  --color-success: #4ade80;

  /* Typography */
  --font-family: "Inter", system-ui, -apple-system, sans-serif;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 2rem;
  --font-size-hero: clamp(2.5rem, 5vw, 4rem);
  --line-height-body: 1.6;

  /* Spacing */
  --space-xs: 0.5rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-section: 5rem;

  /* Layout */
  --max-width: 1100px;
  --nav-height: 64px;
  --border-radius: 12px;
  --border-radius-sm: 8px;
  --border-radius-pill: 9999px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
}

/* ----- Reset & Base ----- */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: var(--nav-height);
}

body {
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  line-height: var(--line-height-body);
  color: var(--color-text-primary);
  background-color: var(--color-bg-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--color-accent);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-accent-hover);
}

ul {
  list-style: none;
}

img {
  max-width: 100%;
  display: block;
}

/* ----- Navigation ----- */
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--nav-height);
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  z-index: 100;
}

.nav__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: var(--max-width);
  height: 100%;
  margin: 0 auto;
  padding: 0 var(--space-md);
}

.nav__logo {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.05em;
}

.nav__logo:hover {
  color: var(--color-accent);
}

.nav__links {
  display: flex;
  gap: var(--space-lg);
}

.nav__links a {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  transition: color var(--transition-fast);
}

.nav__links a:hover {
  color: var(--color-text-primary);
}

/* ----- Shared Section Styles ----- */
.section {
  padding: var(--space-section) 0;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--space-md);
}

.section__title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  margin-bottom: var(--space-xl);
  position: relative;
  display: inline-block;
}

.section__title::after {
  content: "";
  position: absolute;
  bottom: -8px;
  left: 0;
  width: 48px;
  height: 3px;
  background: var(--color-accent);
  border-radius: var(--border-radius-pill);
}

/* ----- Hero ----- */
.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--nav-height) var(--space-md) var(--space-xl);
  background: linear-gradient(
    170deg,
    var(--color-bg-primary) 0%,
    var(--color-bg-secondary) 100%
  );
}

.hero__content {
  text-align: center;
  max-width: 640px;
}

.hero__greeting {
  font-size: var(--font-size-lg);
  color: var(--color-accent);
  margin-bottom: var(--space-xs);
  font-weight: 600;
}

.hero__title {
  font-size: var(--font-size-hero);
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: var(--space-md);
}

.hero__tagline {
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xl);
}

.hero__cta {
  display: inline-block;
  padding: 0.75rem 2rem;
  background: var(--color-accent);
  color: var(--color-bg-primary);
  font-weight: 600;
  border-radius: var(--border-radius-sm);
  transition: background var(--transition-base), transform var(--transition-base);
}

.hero__cta:hover {
  background: var(--color-accent-hover);
  color: var(--color-bg-primary);
  transform: translateY(-2px);
}

/* ----- About ----- */
.about {
  background: var(--color-bg-secondary);
}

.about__text {
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
  max-width: 720px;
  line-height: 1.8;
}

/* ----- Projects ----- */
.projects__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-lg);
}

.project-card {
  background: var(--color-bg-secondary);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: var(--border-radius);
  padding: var(--space-lg);
  transition: transform var(--transition-base), box-shadow var(--transition-base);
}

.project-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
}

.project-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.project-card__title {
  font-size: 1.25rem;
  font-weight: 600;
}

.project-card__tag {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.75rem;
  background: rgba(56, 189, 248, 0.15);
  color: var(--color-accent);
  border-radius: var(--border-radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.project-card__desc {
  color: var(--color-text-secondary);
  margin-bottom: var(--space-md);
  font-size: 0.95rem;
}

.project-card__tech {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.project-card__tech li {
  font-size: 0.8rem;
  padding: 0.2rem 0.6rem;
  background: var(--color-surface);
  border-radius: var(--border-radius-pill);
  color: var(--color-text-secondary);
}

/* ----- Skills ----- */
.skills {
  background: var(--color-bg-secondary);
}

.skills__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.skill-pill {
  padding: 0.5rem 1.25rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: var(--border-radius-pill);
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  transition: border-color var(--transition-fast), color var(--transition-fast);
}

.skill-pill:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

/* ----- Contact ----- */
.contact {
  text-align: center;
}

.contact__text {
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
  max-width: 540px;
  margin: 0 auto var(--space-xl);
}

.contact__btn {
  display: inline-block;
  padding: 0.875rem 2.5rem;
  background: transparent;
  border: 2px solid var(--color-accent);
  color: var(--color-accent);
  font-weight: 600;
  border-radius: var(--border-radius-sm);
  transition: background var(--transition-base), color var(--transition-base),
    transform var(--transition-base);
}

.contact__btn:hover {
  background: var(--color-accent);
  color: var(--color-bg-primary);
  transform: translateY(-2px);
}

/* ----- Footer ----- */
.footer {
  padding: var(--space-lg) var(--space-md);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

/* ----- Responsive Breakpoints ----- */

/* Tablet (768px and below) */
@media (max-width: 768px) {
  :root {
    --space-section: 3.5rem;
  }

  .projects__grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .nav__links {
    gap: var(--space-sm);
  }
}

/* Mobile (480px and below) */
@media (max-width: 480px) {
  :root {
    --space-section: 3rem;
  }

  .projects__grid {
    grid-template-columns: 1fr;
  }

  .nav__links {
    display: none;
  }

  .hero__content {
    padding: 0 var(--space-sm);
  }

  .section__title {
    font-size: 1.5rem;
  }
}

/* ----- Animations ----- */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hero__content {
  animation: fadeInUp 0.8s ease both;
}

.project-card {
  animation: fadeInUp 0.6s ease both;
}

.project-card:nth-child(2) {
  animation-delay: 0.15s;
}

.project-card:nth-child(3) {
  animation-delay: 0.3s;
}

/* ----- Focus styles for accessibility ----- */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

/* ----- Selection ----- */
::selection {
  background: rgba(56, 189, 248, 0.3);
  color: var(--color-text-primary);
}`;

const QA_REPORT = `# QA Review Report - Portfolio Website

## Overall Score: 92/100

### Accessibility (23/25)
- Semantic HTML5 elements used correctly throughout
- Proper heading hierarchy (h1 > h2 > h3)
- ARIA labels present on navigation and list elements
- Recommendation: add skip-to-content link for keyboard users

### Responsiveness (24/25)
- Three breakpoints implemented (desktop, tablet, mobile)
- Navigation collapses gracefully on mobile
- Grid layout adapts from 3-column to single-column
- Minor: hero CTA button could use wider tap target on mobile

### Performance (23/25)
- CSS custom properties reduce repetition
- Single external font with display=swap
- No render-blocking scripts
- Suggestion: consider adding preload for the font stylesheet

### Visual Design (22/25)
- Dark theme is consistent and professional
- Accent color provides clear visual hierarchy
- Hover states and transitions feel polished
- Note: project card hover lift could benefit from a subtle shadow transition

## Summary
The portfolio site meets professional standards. Four minor recommendations
noted above - none are blockers. Approving for delivery.
`;

const PROJECT_SUMMARY = `# Project Summary - Portfolio Website

## Completed
- UX research conducted with web trend analysis
- Design spec produced covering layout, color palette, typography, and components
- Semantic HTML5 page built with full accessibility markup
- Modern dark-themed CSS with responsive breakpoints and animations
- QA review passed with 92/100 score

## Deliverables
- \`site/index.html\` - Complete portfolio page
- \`site/styles.css\` - Responsive stylesheet
- \`artifacts/design-spec.md\` - Design specification
- \`artifacts/qa-report.md\` - QA review report

## Status: Complete
All agents finished successfully. The site is ready for deployment.
`;

// ---------------------------------------------------------------------------
// The demo script
// ---------------------------------------------------------------------------

export const DEMO_SCRIPT: ScriptMap = {

  // =========================================================================
  // PROJECT LEAD - 4 turns
  // =========================================================================
  'agents/project-lead.md': [

    // --- Turn 1: Plan the project, write to memory, spawn UX Researcher ---
    [
      text('Great, a portfolio website. Let me break this down into phases and get the team moving.'),
      text(' I will start by writing a project plan, then bring in our UX researcher to gather design trends before we build anything.'),
      tc('tc-demo-001', 'memory_write', {
        key: 'project-plan',
        value: 'Project: Portfolio Website\n\nPhase 1 - Research: UX Researcher gathers portfolio design trends\nPhase 2 - Design: Designer creates component specifications\nPhase 3 - Build: HTML Dev and CSS Dev implement in parallel\nPhase 4 - QA: QA Reviewer audits final output',
        tags: 'planning,project',
      }),
      text(' Project plan saved. Now let me bring in the UX researcher to look at current portfolio design trends.'),
      tc('tc-demo-002', 'spawn_agent', {
        filename: 'agents/ux-researcher.md',
        content: '(pre-existing agent)',
        task: 'Research current portfolio website design trends. Focus on layout patterns, color schemes, and what makes a developer portfolio stand out. Write your findings to memory and artifacts, then signal me when done.',
      }),
      text(' UX Researcher is activated. I will wait for their research findings before moving to the design phase.'),
      done(342),
    ],

    // --- Turn 2: Acknowledge research, spawn Designer + HTML Dev + CSS Dev ---
    [
      text('Research is in. The UX researcher found strong trends around dark themes, minimal layouts, and prominent project showcases.'),
      text(' Time to move into the design and build phase. I will spawn the designer first to create specs, then the developers to implement.'),
      tc('tc-demo-003', 'spawn_agent', {
        filename: 'agents/designer.md',
        content: '(pre-existing agent)',
        task: 'Create a detailed design specification for a dark-themed developer portfolio website. Read the research from memory, then write the spec to artifacts/design-spec.md. Signal me when the spec is ready.',
      }),
      tc('tc-demo-004', 'spawn_agent', {
        filename: 'agents/html-dev.md',
        content: '(pre-existing agent)',
        task: 'Build the HTML for a portfolio website based on the design spec at artifacts/design-spec.md. Create a complete, semantic, accessible page at site/index.html. Signal me when done.',
      }),
      tc('tc-demo-005', 'spawn_agent', {
        filename: 'agents/css-dev.md',
        content: '(pre-existing agent)',
        task: 'Create the stylesheet for a portfolio website based on the design spec at artifacts/design-spec.md. Write a complete, responsive, dark-themed CSS file to site/styles.css. Signal me when done.',
      }),
      text(' Designer, HTML Dev, and CSS Dev are all activated. They will work from the research findings and coordinate through the design spec.'),
      done(410),
    ],

    // --- Turn 3: Build complete, spawn QA Reviewer ---
    [
      text('All build agents have reported in - HTML and CSS are written. Now let me bring in QA to audit the site before we ship.'),
      tc('tc-demo-006', 'spawn_agent', {
        filename: 'agents/qa-reviewer.md',
        content: '(pre-existing agent)',
        task: 'Review the portfolio website at site/index.html and site/styles.css. Use the design_review tool to evaluate quality, then write a detailed report to artifacts/qa-report.md. Signal me with a pass/fail verdict.',
      }),
      text(' QA Reviewer is activated. They will audit against the design spec and report back with a score.'),
      done(285),
    ],

    // --- Turn 4: Final summary ---
    [
      text('QA passed with a 92/100 score. Four minor suggestions noted, but nothing blocking delivery. Let me write the final summary.'),
      tc('tc-demo-007', 'vfs_write', {
        path: 'artifacts/summary.md',
        content: PROJECT_SUMMARY,
      }),
      text(' Project complete. The portfolio website has been built with semantic HTML, responsive CSS, a dark theme, and passed QA review. All deliverables are in the artifacts and site directories.'),
      done(390),
    ],
  ],

  // =========================================================================
  // UX RESEARCHER - 1 turn
  // =========================================================================
  'agents/ux-researcher.md': [
    [
      text('Starting research on portfolio design trends. Let me search for what is working well in 2026 developer portfolios.'),
      tc('tc-demo-008', 'web_search', {
        query: 'best developer portfolio website design trends 2026',
      }),
      text(' Found several useful results. Let me pull details from a top article on modern portfolio patterns.'),
      tc('tc-demo-009', 'web_fetch', {
        url: 'https://uxdesign.cc/portfolio-trends-2026',
      }),
      text(' The research confirms key trends: dark color schemes dominate developer portfolios, single-page layouts with smooth scrolling convert better, and prominent project showcases with live demos are expected. Let me save these findings.'),
      tc('tc-demo-010', 'memory_write', {
        key: 'research-summary',
        value: 'Portfolio Design Trends 2026:\n\n1. Dark themes dominate (80%+ of top portfolios use dark backgrounds)\n2. Single-page scrolling layouts with section-based navigation\n3. Hero sections with name, title, and single CTA\n4. Project cards in 3-column grid with hover interactions\n5. Minimal color palettes: dark base + single accent color (blue/cyan popular)\n6. Inter and system fonts preferred over decorative typefaces\n7. Subtle animations on scroll, no heavy motion\n8. Skills displayed as pill/tag components\n9. Clear contact CTA near the bottom\n10. Mobile-first responsive approach essential',
        tags: 'research,design,trends',
      }),
      tc('tc-demo-011', 'vfs_write', {
        path: 'artifacts/research/ux-findings.md',
        content: '# UX Research Findings\n\n## Key Trends\n- Dark theme with a single accent color (sky blue / cyan most popular)\n- Single-page scroll layout with fixed navigation\n- Hero section: name + tagline + one CTA button\n- 3-column project grid with hover lift animations\n- Skills as pill-shaped tags\n- Minimal footer, centered contact CTA\n\n## Typography\n- Inter or system font stacks dominate\n- Large hero text (clamp-based fluid sizing)\n- 1.6 line-height for readability\n\n## Layout\n- Max content width around 1100px\n- Section padding 60-80px vertical\n- Cards with 12px border radius\n\n## Recommendations\n- Use a dark slate palette (#0f172a base) with sky-400 accent\n- Keep animations subtle - translateY hover lifts and fade-ins\n- Ensure AA contrast ratios throughout\n',
      }),
      text(' Research report written. Signaling the project lead with a summary.'),
      tc('tc-demo-012', 'signal_parent', {
        message: 'Research complete. Key findings: dark theme with sky-blue accent, single-page scroll layout, 3-column project grid, Inter font, and pill-style skill tags. Full report at artifacts/research/ux-findings.md.',
      }),
      done(520),
    ],
  ],

  // =========================================================================
  // DESIGNER - 1 turn
  // =========================================================================
  'agents/designer.md': [
    [
      text('Let me review the research findings before creating the design specification.'),
      tc('tc-demo-013', 'memory_read', {
        query: 'research design trends',
        tags: 'research',
      }),
      text(' The research is clear on direction: dark slate palette, sky-blue accent, Inter font, single-page scroll. Let me translate this into a detailed design spec that the developers can implement from.'),
      tc('tc-demo-014', 'vfs_write', {
        path: 'artifacts/design-spec.md',
        content: DESIGN_SPEC,
      }),
      text(' Design spec written with complete layout, color palette, typography, and component definitions. Signaling the project lead.'),
      tc('tc-demo-015', 'signal_parent', {
        message: 'Design spec complete at artifacts/design-spec.md. Defined dark slate theme with sky-400 accent, Inter typography, and specs for nav, hero, project cards, skills pills, contact CTA, and footer.',
      }),
      done(465),
    ],
  ],

  // =========================================================================
  // HTML DEVELOPER - 1 turn
  // =========================================================================
  'agents/html-dev.md': [
    [
      text('Reading the design spec to understand the component structure before writing HTML.'),
      tc('tc-demo-016', 'vfs_read', {
        path: 'artifacts/design-spec.md',
      }),
      text(' Design spec reviewed. I will build a semantic HTML5 page with proper landmarks, heading hierarchy, and ARIA attributes for accessibility. Creating the portfolio page now.'),
      tc('tc-demo-017', 'vfs_write', {
        path: 'site/index.html',
        content: PORTFOLIO_HTML,
      }),
      text(' HTML complete with all sections: nav, hero, about, projects (3 cards), skills (12 pills), contact, and footer. All elements use semantic HTML5 and include ARIA labels. Signaling the project lead.'),
      tc('tc-demo-018', 'signal_parent', {
        message: 'HTML build complete. Created site/index.html with semantic structure including nav, hero, about, 3 project cards, 12 skill pills, contact CTA, and footer. All accessibility landmarks and ARIA attributes in place.',
      }),
      done(580),
    ],
  ],

  // =========================================================================
  // CSS DEVELOPER - 1 turn
  // =========================================================================
  'agents/css-dev.md': [
    [
      text('Let me read the design spec to extract the exact token values and component requirements.'),
      tc('tc-demo-019', 'vfs_read', {
        path: 'artifacts/design-spec.md',
      }),
      text(' Got the full token set and component specs. I will create a stylesheet using CSS custom properties, a dark slate palette, responsive breakpoints, and polished transitions. Writing now.'),
      tc('tc-demo-020', 'vfs_write', {
        path: 'site/styles.css',
        content: PORTFOLIO_CSS,
      }),
      text(' Stylesheet complete with custom properties, dark theme, three responsive breakpoints, hover animations, and accessibility focus styles. Signaling the project lead.'),
      tc('tc-demo-021', 'signal_parent', {
        message: 'CSS build complete. Created site/styles.css with custom properties, dark slate theme, responsive breakpoints (desktop/tablet/mobile), hover transitions, fade-in animations, and focus-visible styles for accessibility.',
      }),
      done(545),
    ],
  ],

  // =========================================================================
  // QA REVIEWER - 1 turn
  // =========================================================================
  'agents/qa-reviewer.md': [
    [
      text('Starting QA review. Let me read both the HTML and CSS files, then run the design review tool.'),
      tc('tc-demo-022', 'vfs_read', {
        path: 'site/index.html',
      }),
      tc('tc-demo-023', 'vfs_read', {
        path: 'site/styles.css',
      }),
      text(' Both files loaded. Running the design review tool to evaluate quality, accessibility, and adherence to the spec.'),
      tc('tc-demo-024', 'design_review', {
        html_path: 'site/index.html',
        css_path: 'site/styles.css',
      }),
      text(' Review complete. The site scores 92/100 overall. Strong marks for semantic HTML, responsive design, and visual consistency. Four minor suggestions: add skip-to-content link, widen mobile tap targets, preload fonts, and enhance card shadow transitions. Writing the full report now.'),
      tc('tc-demo-025', 'vfs_write', {
        path: 'artifacts/qa-report.md',
        content: QA_REPORT,
      }),
      text(' QA report written. Signaling the project lead with the verdict.'),
      tc('tc-demo-026', 'signal_parent', {
        message: 'QA review passed - 92/100. Accessibility: 23/25, Responsiveness: 24/25, Performance: 23/25, Visual Design: 22/25. Four minor recommendations noted, no blockers. Approving for delivery.',
      }),
      done(495),
    ],
  ],
};
