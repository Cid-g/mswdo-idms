# UI/UX DESIGN SPECIFICATION — MSWDO ID Management System

**Project:** Secure Municipal ID Issuance & QR-Based Verification System  
**Target Users:** Government staff (MSWDO Gerona, Tarlac) — admins, encoders, releasing staff  
**Tech Stack:** React 18 + Vite, Tailwind CSS, shadcn/ui  
**Prepared for:** Claude Code implementation reference

---

## 1. AESTHETIC DIRECTION

### Concept: "Dignified Clarity"

The MSWDO serves vulnerable citizens — PWDs, Solo Parents, Senior Citizens. The system must project **trustworthiness, competence, and care** without feeling sterile or bureaucratic. 

**Visual Personality:** Refined civic modernism — the confidence of an institution that takes its work seriously, softened by warmth and human-centered design. Think of a beautifully designed passport office, not a drab government form.

**What makes it unforgettable:**
- Department color coding is pervasive and purposeful — the moment staff logs in, they instantly know which department they're in via warm, distinctive accent colors
- Cards and forms feel **tactile** — subtle shadows, slight radius, and micro-borders that suggest depth without being heavy
- Data-heavy forms are tamed by a **multi-step wizard UI** with visible progress — encoding 37 fields feels manageable because they're revealed in logical groups
- The ID preview/print page looks like an **actual government document viewer** — not just a form dump

**What to avoid:**
- Flat, lifeless government portals (no flat grey tables everywhere)
- Material Design blandness
- Dark mode that looks like a developer tool
- Overly playful — this is a serious system for vulnerable citizens

---

## 2. STYLE SELECTION

**Chosen Style: Refined Civic + Subtle Glassmorphism accents**

- **Primary language:** Clean cards with 8px radius, consistent spacing, strong typographic hierarchy
- **Glass accents:** Dashboard stat cards use frosted glass effect (backdrop-filter: blur) over colored department backgrounds — adds depth without being gimmicky
- **Not:** Full glassmorphism everywhere (too fragile-feeling for data entry)
- **Sidebar:** Dark navy sidebar that grounds the layout — provides contrast anchor

**Justification:** Government users need high data density + cognitive clarity. Glassmorphism-on-white fails for forms (too much visual noise). But glass stat cards on a rich department background look premium and unique. The combination signals "this is modern and well-built" to staff who are used to Excel and bad PHP portals.

---

## 3. COLOR PALETTE

### Base Tokens (CSS Variables)

```css
:root {
  /* ── NEUTRAL SCALE ─────────────────────────────── */
  --color-white:     #FFFFFF;
  --color-surface:   #F7F8FA;      /* page background */
  --color-surface-2: #EDEEF2;      /* subtle dividers, hover states */
  --color-border:    #DDE1EA;
  --color-muted:     #8B92A5;      /* placeholder text, secondary labels */
  --color-text-2:    #4B5468;      /* secondary text */
  --color-text-1:    #1A1F2E;      /* primary text */

  /* ── SIDEBAR ───────────────────────────────────── */
  --sidebar-bg:      #0F1623;      /* deep navy — anchors layout */
  --sidebar-surface: #1A2236;
  --sidebar-text:    #A8B4CC;
  --sidebar-active:  #FFFFFF;

  /* ── SEMANTIC ──────────────────────────────────── */
  --color-success:   #16A34A;
  --color-success-bg:#DCFCE7;
  --color-warning:   #D97706;
  --color-warning-bg:#FEF3C7;
  --color-danger:    #DC2626;
  --color-danger-bg: #FEE2E2;
  --color-info:      #0369A1;
  --color-info-bg:   #E0F2FE;

  /* ── SHADOW SCALE ──────────────────────────────── */
  --shadow-sm:  0 1px 3px rgba(15,22,35,0.07), 0 1px 2px rgba(15,22,35,0.05);
  --shadow-md:  0 4px 12px rgba(15,22,35,0.08), 0 2px 4px rgba(15,22,35,0.04);
  --shadow-lg:  0 10px 30px rgba(15,22,35,0.10), 0 4px 8px rgba(15,22,35,0.05);
  --shadow-card:0 0 0 1px var(--color-border), 0 2px 8px rgba(15,22,35,0.06);
}
```

### Department Accent Palettes

Each department has its own identity. Used for: sidebar active state, dashboard background gradient, stat card accents, department badge, ID card header color.

```css
/* ── PWD DEPARTMENT — Deep Blue ──────────────────── */
.dept-pwd {
  --dept-primary:    #1E40AF;   /* deep blue */
  --dept-secondary:  #3B82F6;   /* medium blue */
  --dept-light:      #EFF6FF;   /* very light blue background */
  --dept-gradient:   linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%);
  --dept-text:       #1E3A8A;
}

/* ── SOLO PARENT DEPARTMENT — Warm Rose ──────────── */
.dept-solo-parent {
  --dept-primary:    #9F1239;   /* deep rose */
  --dept-secondary:  #E11D48;   /* rose */
  --dept-light:      #FFF1F2;   /* very light rose background */
  --dept-gradient:   linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%);
  --dept-text:       #881337;
}

/* ── SENIOR CITIZEN DEPARTMENT — Warm Amber ─────── */
.dept-senior {
  --dept-primary:    #92400E;   /* deep amber */
  --dept-secondary:  #D97706;   /* amber */
  --dept-light:      #FFFBEB;   /* very light amber background */
  --dept-gradient:   linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%);
  --dept-text:       #78350F;
}

/* ── SUPERADMIN — Slate ───────────────────────────── */
.role-superadmin {
  --dept-primary:    #334155;
  --dept-secondary:  #475569;
  --dept-light:      #F1F5F9;
  --dept-gradient:   linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%);
}
```

### Status Badge Colors

```css
.status-partial   { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; }
.status-complete  { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
.status-revoked   { background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; }
.status-active    { background: #DCFCE7; color: #166534; border: 1px solid #BBF7D0; }
.status-expired   { background: #F3F4F6; color: #4B5563; border: 1px solid #E5E7EB; }
.status-deceased  { background: #F3F4F6; color: #374151; border: 1px solid #D1D5DB; }
```

---

## 4. TYPOGRAPHY SYSTEM

### Font Pairing

```css
/* Display font — for headings, page titles, dashboard numbers */
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');

/* Body font — for all UI text, labels, data */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');
```

**Why this pairing:** DM Serif Display is authoritative and humanist — it says "official document" while remaining warm. DM Sans is its designed partner — clean, legible at small sizes, perfect for dense data. Both share the "DM" DNA so they feel unified.

### Type Scale

```css
/* Tailwind v4 — font families defined in @theme block in index.css */
/* --font-serif: 'DM Serif Display', Georgia, serif; */
/* --font-sans: 'DM Sans', system-ui, sans-serif; */

/* Scale usage guide */
/* text-4xl font-serif  → Page hero headings (e.g., "Person with Disability") */
/* text-3xl font-serif  → Dashboard welcome, section titles */
/* text-2xl font-sans font-semibold → Card headings, modal titles */
/* text-xl font-sans font-semibold  → Section subheadings */
/* text-base font-sans font-normal  → Body text, form values */
/* text-sm font-sans font-medium    → Form labels, table headers */
/* text-xs font-sans font-medium    → Badges, captions, timestamps */

/* Line heights */
--lh-tight:  1.2;   /* headings */
--lh-snug:   1.4;   /* subheadings */
--lh-normal: 1.6;   /* body text */
--lh-loose:  1.8;   /* long-form narrative fields */
```

### Specific Usage

| Element | Class | Notes |
|---------|-------|-------|
| Page title | `text-3xl font-serif text-[--color-text-1]` | Every page has one |
| Stat number | `text-4xl font-serif font-normal` + dept color | Dashboard counts |
| Section header | `text-sm font-sans font-semibold uppercase tracking-wider text-[--color-muted]` | Groups form fields |
| Form label | `text-sm font-sans font-medium text-[--color-text-2]` | |
| Input value | `text-base font-sans text-[--color-text-1]` | |
| Table header | `text-xs font-sans font-semibold uppercase tracking-wide text-[--color-muted]` | |
| Badge | `text-xs font-sans font-semibold` | |

---

## 5. LAYOUT & SPACING

### App Shell

```
┌─────────────────────────────────────────────────┐
│  SIDEBAR (256px fixed)   │   MAIN CONTENT AREA   │
│                          │                       │
│  [Logo + Dept Name]      │  [Topbar: breadcrumb  │
│  [Nav Items]             │   + user avatar]      │
│                          │                       │
│                          │  [Page Content]       │
│                          │                       │
│  [User Info + Logout]    │                       │
└─────────────────────────────────────────────────┘
```

- Sidebar: 256px, fixed, `var(--sidebar-bg)` (#0F1623)
- Main area: `calc(100vw - 256px)`, scrollable
- Topbar: 64px height, sticky, `var(--color-white)`, border-bottom
- Content padding: `px-8 py-6` (32px / 24px)

### Spacing Scale (4px base, 8dp rhythm)

```
4px   → gap-1   (tight: badge padding, icon spacing)
8px   → gap-2   (compact: form field internal padding)
12px  → gap-3   (form element spacing)
16px  → gap-4   (section spacing, card padding compact)
24px  → gap-6   (card padding standard)
32px  → gap-8   (section gaps, page padding)
48px  → gap-12  (major section breaks)
64px  → gap-16  (hero/banner areas)
```

### Grid System

```css
/* Main content grid */
.content-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px;
}

/* Common layouts */
.col-full     { grid-column: span 12; }  /* full width */
.col-half     { grid-column: span 6; }   /* 2-column */
.col-third    { grid-column: span 4; }   /* 3-column (stat cards) */
.col-quarter  { grid-column: span 3; }   /* 4-column */
.col-sidebar  { grid-column: span 4; }   /* sidebar card */
.col-main     { grid-column: span 8; }   /* main content */
```

### Breakpoints

```css
/* Tailwind v4 — breakpoints are built-in, no config needed */
/* sm: 640px | md: 768px | lg: 1024px | xl: 1280px | 2xl: 1440px */
/* This is a staff portal — primary use is desktop/laptop (1024px+). Mobile is secondary. */
```

---

## 6. KEY SCREENS / PAGES

### LOGIN PAGE

**Purpose:** Authentication gate  
**Layout:** Full-screen split — left 40% dept brand panel, right 60% form  

Left panel:
- Department gradient background (changes based on context — defaults to slate for initial load)
- MSWDO logo + "Municipality of Gerona" seal
- `DM Serif Display` tagline: "Serving Our Community with Dignity"

Right panel:
- Centered card (max-w-md), white background
- Title: "Welcome Back"
- Username + Password inputs
- Login button (full width, dept-colored)
- On error: inline red alert under form

---

### SUPERADMIN DASHBOARD

**Layout:** Rich dashboard, dark navy header banner  

Top section (full width):
- Deep slate gradient banner, height ~160px
- `DM Serif Display` welcome: "Good morning, [Name]"
- Subtitle: "System Overview — All Departments"

Stats row (3 dept cards):
- Each card: glassmorphism on dept gradient background
- Shows: Total Applicants, Active IDs, Partial Records, Dept Name
- Hover: card lifts with stronger shadow

Charts row (2 columns):
- Left (8 cols): Line chart — ID issuance trend last 12 months, 3 colored lines
- Right (4 cols): User distribution donut chart

Bottom: User count table — clean, striped rows

---

### ADMIN DASHBOARD

**Layout:** Dept-colored top banner + 4 stats + activity + chart  

Top banner: dept gradient (PWD = deep blue, Solo Parent = rose, Senior = amber)
- Department name in `DM Serif Display`
- Staff count subtitle

4 stat cards (3-col each):
- Total Applicants, Active IDs, Partial (needs completion), Revoked

Bottom row:
- Left (8 cols): Monthly bar chart
- Right (4 cols): Recent activity feed (10 items, timeline style)

---

### APPLICANT LIST

**Purpose:** Browse + search all applicants in dept  
**Layout:** Full-width table with top action bar

Top bar:
- Left: Page title "Applicants" + count badge
- Right: Search input + Status filter dropdown + "New Applicant" button (dept-color)

Table:
- Columns: Control No. | Full Name | Age/Sex | Barangay | Status | Date Created | Actions
- Status column: colored badge (PARTIAL = amber, COMPLETE = green, REVOKED = red)
- Row hover: light dept-color tint
- Empty state: illustration + "No applicants yet. Create the first one."

Pagination: bottom, showing "Showing X–Y of Z"

---

### NEW APPLICANT — QUICK ENCODE

**Purpose:** Fast intake, minimum fields for ID generation  
**Layout:** Stepper wizard (3 steps), centered card (max-w-2xl)

Step indicator at top:
```
① Basic Info  ──  ② Photo & Signature  ──  ③ Generate ID
```
- Active step: filled dept-color circle + bold label
- Completed: checkmark + dept-color
- Future: grey circle + grey label

**Step 1: Basic Info**  
Two-column grid for form fields:

Step 1 shows dept-specific fields only — rendered by dept-specific components:
- `<PWDQuickEncodeFields>` — 10 fields: name/extension, birthdate, barangay, disability type (full-width), emergency contact name + number
- `<SeniorCitizenQuickEncodeFields>` — 6 fields: name/extension, birthdate (with live age chip), barangay. Fewest fields.
- `<SoloParentQuickEncodeFields>` — 15+ fields: name/extension, birthdate + birthplace*, barangay + category code, children section (dynamic, min 1), emergency contact (name, number, address)

> **Sex is NOT in Step 1 (quick encode).** It belongs to the Complete Profile (Step 2/accordion) only. Sex is not needed to generate the ID card.
> *Birthplace is required for Solo Parent (appears on ID front).

**Step 2: Photo & Signature**  
Two panels side by side:

Photo panel (left):
- Large upload zone (dashed border, dept-color on hover)
- "Click to upload or drag photo here"
- After upload: crop interface appears inline (react-image-crop)
  - Aspect ratio locked 3:4
  - Dept-colored crop handles
- After crop: "Remove Background" button
  - Loading state: spinner + "Processing..."
  - After: before/after toggle (split slider)
  - Confirm / Redo buttons

Signature panel (right):
- Tab: "Draw" — signature canvas, dept-colored ink, clear button
- Tab: "Upload" — file upload zone
- Preview of captured signature

**Step 3: Confirm & Generate**  
Summary review card showing:
- Applicant name + dept badge
- Photo thumbnail (circular) + signature preview
- Key fields summary
- "Generate ID Now" button — large, dept-color, prominent

---

### APPLICANT DETAIL

**Purpose:** View + edit full applicant record, access ID
**Layout:** Accordion-based (NOT tabs — decided in PROGRESS.md)

**Why accordion instead of tabs:** Supports two-phase encoding workflow. Incomplete sections auto-expand and highlight missing fields. Staff can see at a glance what needs to be filled.

**Header card:**
- Circular photo (56px, dept-color border) + full name (DM Serif) + dept badge + control number
- Status badge: PARTIAL = amber "⚠ Needs Completion" | COMPLETE = green "✓ Complete"
- Profile completion progress bar below header

**Accordion sections** — each section has:
- Status icon (green check = complete, amber alert = has missing fields, grey dash = not started)
- Title + badge ("Complete" / "X missing" / "Not started")
- Auto-expands if section has empty required fields
- Auto-collapses when section becomes complete
- Auto-saves when user collapses (PATCH /applicants/:id)

**Dept-specific sections:**
- PWD: Personal Info | Photo & Signature | Socio-Economic | Organization & Skills | Case Management | Form Tracking | ID Record
- Solo Parent: Personal Info | Children | Emergency Contact | Photo & Signature | Additional Details | Employment | Program Participation | Children Counts | Case Management | ID Record
- Senior Citizen: Personal Info | Photo & Signature | Personal Details | Health | ID Registration | Pension | Status & Remarks | ID Record

**Incomplete field highlighting:**
When a section is open and a field is empty, it shows amber border + "Not yet filled" hint text below.

**"Complete Full Profile" button:**
Dashed border button at bottom of page. Only visible when record is PARTIAL.
Clicking expands all sections with missing fields simultaneously and scrolls to first empty field.

**Field section headers** styled as:
```
PERSONAL INFORMATION  ────────────────
[ fields ]

DISABILITY INFORMATION (PWD only)  ───
[ fields ]
```

> Note: Documents tab REMOVED. Document verification is done manually offline — not in system.

---

### ID CARD VIEW / PRINT

**Purpose:** Preview rendered ID before printing  
**Layout:** Clean, document-focused

- White page bg, narrow content column (max-w-lg, centered)
- Rendered ID image (actual proportions, 85.6mm × 54mm scaled up)
- Front / Back tabs if applicable (Solo Parent has filled back)
- Action bar: Print | Download PNG | Download PDF | Back

Blockchain status section below ID:
```
┌──────────────────────────────────────┐
│  ✅  Blockchain Integrity Verified   │
│  Anchored: May 19, 2026 · TX #abc123 │
│  [Verify Again]                      │
└──────────────────────────────────────┘
```
OR:
```
┌──────────────────────────────────────┐
│  ⏳  Pending Blockchain Anchor       │
│  Complete the record profile first   │
└──────────────────────────────────────┘
```

---

### ID TEMPLATE EDITOR

**Purpose:** Upload template image + drag placeholders  
**Layout:** Full-width split canvas

Left (65%): Template canvas
- Template PNG displayed at scale
- Colored overlay boxes for each active placeholder
- Click to select placeholder → shows resize handles
- Each placeholder has a color-coded type label

Right (35%): Placeholder panel
- List of all possible placeholders
- Toggle checkbox to enable/disable
- When selected: shows controls:
  - For image zones: x, y, width, height (editable + draggable)
  - For text: font size, color picker, x, y

Bottom bar: Cancel | Preview with Sample Data | Save Template

---

### AUDIT LOG

**Layout:** Filter bar + timeline-style list (not just a table)

Filters: Date range | Department (SA) | User | Action type

Each log item (timeline style):
```
●  [Action Icon]  LOGIN  ·  2026-05-19 10:42 AM
   Maria Santos (Encoder · PWD)
   "Logged in from 192.168.1.15"
```

Action icons:
- 🔑 Login/Logout
- 👤 User created/updated
- 📝 Applicant created/updated
- 🪪 ID generated
- 🖨️ ID printed/reprinted
- 🚫 ID revoked
- ⛓️ Blockchain anchor
- 📄 Template uploaded

---

## 7. COMPONENT INVENTORY

### Buttons

```
Primary:     bg-[dept-color] text-white hover:brightness-90 active:brightness-75
             height: 40px, px-16px, rounded-lg, font-sans font-semibold text-sm

Secondary:   bg-white border border-[--color-border] text-[--color-text-1]
             hover:bg-[--color-surface]

Danger:      bg-white border border-[--color-danger] text-[--color-danger]
             hover:bg-[--color-danger-bg]

Destructive: bg-[--color-danger] text-white (for confirmed destructive actions)

Ghost:       no bg, no border, text-[--color-text-2] hover:bg-[--color-surface]

Icon button: 36×36px, rounded-lg
```

States for all: `disabled:opacity-50 disabled:cursor-not-allowed`  
Loading state: spinner icon replaces text, cursor-wait

---

### Cards

```jsx
// Standard card
<div className="bg-white rounded-xl shadow-[var(--shadow-card)] p-6">

// Stat card (glass on gradient)
<div className="rounded-xl backdrop-blur-sm bg-white/15 border border-white/25 p-6 text-white">

// Elevated card (form sections)
<div className="bg-white rounded-xl shadow-md p-6 border border-[--color-border]">
```

---

### Form Inputs

```
Label:    block text-sm font-medium text-[--color-text-2] mb-1.5
Input:    w-full h-10 px-3 rounded-lg border border-[--color-border]
          bg-white text-[--color-text-1] text-sm
          focus:outline-none focus:ring-2 focus:ring-[dept-color]/30 focus:border-[dept-color]
          placeholder:text-[--color-muted]
          disabled:bg-[--color-surface] disabled:text-[--color-muted]

Error:    border-[--color-danger] focus:ring-[--color-danger]/30
Error msg: text-xs text-[--color-danger] mt-1

Select:   same as Input + chevron icon

Textarea: same as Input, min-h-[80px], resize-y
```

Auto-computed fields:
```
Display as read-only with light grey bg
Badge label: "Auto-computed" in top-right corner
```

---

### Step Wizard Progress Bar

```jsx
<div className="flex items-center justify-between mb-8">
  {steps.map((step, i) => (
    <div key={i} className="flex items-center">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
        i < current && "bg-[dept-color] text-white",     // completed
        i === current && "bg-[dept-color] text-white ring-4 ring-[dept-color]/20",  // active
        i > current && "bg-[--color-surface] text-[--color-muted] border border-[--color-border]"  // future
      )}>
        {i < current ? <CheckIcon /> : i + 1}
      </div>
      <span className={cn("ml-2 text-sm font-medium", 
        i <= current ? "text-[--color-text-1]" : "text-[--color-muted]"
      )}>{step.label}</span>
      {i < steps.length - 1 && <div className={cn("mx-4 h-px w-16",
        i < current ? "bg-[dept-color]" : "bg-[--color-border]"
      )} />}
    </div>
  ))}
</div>
```

---

### Modals

```
Backdrop:  fixed inset-0 bg-black/40 backdrop-blur-sm z-50
Container: bg-white rounded-2xl shadow-xl max-w-md w-full mx-auto mt-16
Header:    px-6 pt-6 pb-4 border-b border-[--color-border]
Body:      px-6 py-5
Footer:    px-6 pb-6 pt-4 border-t border-[--color-border] flex justify-end gap-3
```

Types:
- **Confirm action** (revoke, deactivate) — danger icon header, destructive button
- **Success** — green checkmark, auto-closes after 3s
- **Form modal** (create staff account)

---

### Status Badges

```jsx
const variants = {
  PARTIAL:   "bg-amber-50 text-amber-800 border border-amber-200",
  COMPLETE:  "bg-green-50 text-green-800 border border-green-200",
  REVOKED:   "bg-red-50 text-red-800 border border-red-200",
  ACTIVE:    "bg-green-50 text-green-800 border border-green-200",
  EXPIRED:   "bg-gray-100 text-gray-600 border border-gray-200",
  DECEASED:  "bg-gray-100 text-gray-700 border border-gray-200",
  TRANSFERRED: "bg-blue-50 text-blue-800 border border-blue-200",
}

// Usage:
<span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold", variants[status])}>
  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
  {statusLabel}
</span>
```

---

### Department Badge

```jsx
const deptColors = {
  PWD:           "bg-blue-100 text-blue-800 border border-blue-200",
  SOLO_PARENT:   "bg-rose-100 text-rose-800 border border-rose-200",
  SENIOR_CITIZEN:"bg-amber-100 text-amber-800 border border-amber-200",
}
```

---

### Sidebar Navigation

```
Width: 256px, fixed left, full height
Background: var(--sidebar-bg) = #0F1623
Top: Logo area — 72px height, dept icon + "MSWDO" text + dept name in smaller text
Nav items:
  - Icon (20px) + Label
  - Default: text-[--sidebar-text]
  - Active: bg-white/10 text-white rounded-lg
  - Hover: bg-white/5
  - Padding: px-3 py-2.5, mx-2
  - Active indicator: 3px left border in dept-color
Bottom (fixed): User avatar + name + role badge + logout button
```

---

### Photo Editor Component

```
Container: bordered dashed box, 320px × 280px min
States:
  1. Empty:   Upload zone — cloud icon + "Click to upload or drag photo" + file type hint
  2. Crop:    react-image-crop overlay on image, aspect 3:4 locked, dept-colored handles
  3. Processing: spinner overlay + "Removing background..."
  4. Preview: before/after split view with drag handle
              "Looks good" (✓) and "Try again" (↺) buttons
```

---

### Signature Pad Component

```
Tabs: [ ✏️ Draw ] [ ⬆ Upload ]

Draw tab:
  - Canvas: 300×120px, white bg, thin border
  - Ink: dark navy (#1A1F2E) at 1.5px width
  - Below: "Clear" ghost button
  - Instruction: "Sign within the box using your mouse or touchscreen"

Upload tab:
  - Standard upload zone
  - Accepts: JPG, PNG
  - Preview of uploaded signature (white bg, border)
```

---

### Children Info Section (Solo Parent only)

Dynamic list of children with Add/Remove:

```
Child 1
┌─────────────────────────────────────────┐
│ [Last Name]  [First Name]  [Middle Name] │
│ [Birthdate]  [Sex ▾]       [Relationship]│
└─────────────────────────────────────────┘
                                 [× Remove]

[+ Add Child]  button — outlined, full width
```

Minimum: 1 child. Max: 6 (ID back has 6 rows).  
Children beyond 6: allowed in system but only first 6 print on ID.

---

### Disability Type Dropdown (PWD only)

Special dropdown with category numbers and descriptions:

```
1. Deaf or Hard of Hearing
2. Intellectual Disability
3. Learning Disability
4. Mental Disability
5. Physical Disability (Orthopedic)
6. Psychosocial Disability
7. Speech and Language Impairment
8. Visual Disability
9. Cancer (R.A. 11215)
10. Rare Disease (R.A. 10747)
```

Show the full description in dropdown option, but shorten to category name in the selected state.

---

### Solo Parent Category Dropdown

12 options with code + full label:

```
a1 — Consequence of Rape
a2 — Widow/Widower
a3 — Spouse of PDL (Person Deprived of Liberty)
a4 — Spouse of PWD (unable to work)
a5 — Separated or de facto separated
a6 — Annulled
a7 — Abandonment of Spouse
b  — Spouse/Relative of OFW
c  — Unmarried person with child
d  — Legal Guardian / Adoptive / Foster Parent
e  — Relative caring for child
f  — Pregnant woman (no partner)
```

Show `[code]` prefix in the selected state for space efficiency.

---

## 8. MOTION & ANIMATION

### Timing Rules

```css
--duration-fast:   150ms;   /* hover states, tooltips */
--duration-normal: 200ms;   /* button presses, small state changes */
--duration-slow:   300ms;   /* modals opening, page transitions */
--duration-enter:  400ms;   /* complex enter animations */

--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);  /* most UI motion */
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);  /* items entering screen */
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);  /* items leaving screen */
--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275); /* bounce for delight moments */
```

### Key Animations

**Page enter (route transition):**
```css
@keyframes page-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: page-enter 300ms var(--ease-decelerate); }
```

**Dashboard stat cards — staggered reveal:**
```jsx
// Each card gets animation-delay: index * 80ms
<div style={{ animationDelay: `${index * 80}ms` }} className="animate-fade-up">
```

**Modal:**
```css
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.95) translateY(-8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

**Form step transition:**
```css
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

**ID card generation success:**
When the ID is generated, the ID preview slides up with a spring bounce — the one "delight moment" that makes staff feel the system worked.

```css
@keyframes id-appear {
  from { opacity: 0; transform: translateY(30px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.id-card { animation: id-appear 500ms var(--ease-spring); }
```

### Hover & Interaction

```css
/* Buttons */
.btn-primary:hover  { filter: brightness(0.9); transition: filter 150ms; }
.btn-primary:active { filter: brightness(0.8) scale(0.98); }

/* Table rows */
.table-row:hover { background: var(--dept-light); transition: background 150ms; }

/* Cards */
.stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }

/* Nav items */
.nav-item:hover { background: rgba(255,255,255,0.05); transition: background 150ms; }
```

---

## 9. ACCESSIBILITY CHECKLIST

### Contrast Ratios
- [ ] All body text vs background ≥ 4.5:1 (WCAG AA)
- [ ] Large text / headings ≥ 3:1
- [ ] Department accent colors verified on white (dept-primary on white ≥ 4.5:1)
- [ ] Input placeholder text ≥ 3:1
- [ ] Status badge text on badge background ≥ 4.5:1

### Touch Targets
- [ ] All interactive elements ≥ 44×44px touch target
- [ ] Buttons minimum height 40px (most are 40–48px)
- [ ] Table row actions: icon buttons 36px with 8px padding = 52px visual target
- [ ] Signature pad canvas works on touch (touchstart/touchmove events)

### Keyboard Navigation
- [ ] All interactive elements reachable via Tab
- [ ] Modal: focus trapped inside, Escape closes
- [ ] Dropdowns: Arrow keys navigate options
- [ ] Form steps: Enter does not accidentally submit (use type="button" on step nav)
- [ ] Sidebar: keyboard shortcuts for nav (optional enhancement)

### ARIA Requirements
```jsx
// Status badges
<span role="status" aria-label={`Status: ${status}`}>...</span>

// Form fields
<label htmlFor="firstName">First Name <span aria-hidden="true">*</span></label>
<span id="firstName-error" role="alert">{error}</span>

// Modals
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">

// Signature pad
<canvas aria-label="Signature pad — draw your signature here" />

// Photo crop
<div role="region" aria-label="Photo cropping tool">

// Loading states
<div role="status" aria-live="polite" aria-label="Generating ID card...">

// Tables
<th scope="col">Applicant Name</th>
<td headers="name-col">Dela Cruz, Juan</td>
```

### Screen Reader Notes
- Auto-computed fields: add `aria-readonly="true"` and a visually hidden description
- Department context: sidebar should announce department name for SR users
- Form step: announce current step with `aria-live="polite"` on step change

---

## 10. UX GUIDELINES

### Navigation Pattern

**Breadcrumb** in topbar for all pages:
```
Applicants  /  Juan Dela Cruz  /  ID Card
```

**Back navigation:** Always provide a back link/button, not just browser back.

**Active state:** Sidebar highlights the current section. On sub-pages, the parent section stays highlighted.

---

### Feedback States

**Loading:**
- Page-level loading: skeleton screens (not spinners) for lists and detail pages
- Button loading: spinner in button + disabled
- Photo processing: progress overlay with percentage if possible

**Success:**
- Toast notification: slides in from top-right, green, auto-dismisses after 4s
- ID generation: special full-screen success moment (see Motion section)

**Error:**
- Inline form errors: below each field, red text
- Toast for system errors: red, stays until dismissed
- Empty states: friendly illustration + explanation + action button

---

### Form UX Rules

1. **Required fields:** Mark with `*` in label. Group explanation at top: "Fields marked with * are required to generate the ID."
2. **Auto-computed fields:** Show as disabled with a subtle "Auto" badge — users should understand these populate automatically
3. **Barangay dropdown:** Searchable (type to filter) — 44 options is too many to scroll
4. **Long narrative fields** (Services Availed, Needs/Problems for PWD): textarea with character count
5. **Date inputs:** Use date picker — not raw `<input type="date">` (poor UX). Consider react-datepicker styled with dept colors
6. **Children section (Solo Parent):** First child fields appear immediately. "+ Add Child" adds more. Age auto-computes on birthdate entry.
7. **Form persistence:** Auto-save partial data to localStorage every 30 seconds in quick-encode flow

---

### Error Handling

| Error | UI Response |
|-------|------------|
| Network timeout | Toast: "Connection lost. Retrying..." with progress indicator |
| Photo too large (>5MB) | Inline: "Photo is too large. Max 5MB. Please compress and try again." |
| BG removal failure | Toast: "Background removal failed. You can proceed with the original photo." — don't block flow |
| Blockchain service down | Silent degradation — ID generates, toast: "Blockchain anchoring deferred. Will retry automatically." |
| Session expired | Full-page overlay: "Your session has expired. Please log in again." — not just a redirect |
| Duplicate applicant | Warning dialog (not blocker): "A record with similar name and birthdate exists. [View Existing] [Continue Anyway]" |
| Template not configured | Friendly blocked state on "Generate ID" button: info icon + "No active template configured. Ask your admin to upload a template." |

---

### Loading Skeletons

For applicant list:
```jsx
// 5 skeleton rows while loading
<div className="animate-pulse">
  <div className="h-4 bg-gray-200 rounded w-24 mb-2" /> {/* Control No. */}
  <div className="h-4 bg-gray-200 rounded w-40" />       {/* Name */}
</div>
```

For dashboard stat cards: pulse animation on the number area.

---

### Print / ID Card UX

The print view is a special case — it must be clean and usable:
- Hide all navigation, topbar, sidebar
- Show only: ID image + action buttons (non-printing, `@media print { display: none }`)
- ID card dimensions: `85.6mm × 54mm` (standard credit card)
- Resolution: ensure the ID renders at ≥300 DPI equivalent for print quality
- Provide both "Print" (browser dialog) and "Download PNG" options
- Auto-print option: after successful generation, ask "Print now?" — yes/no dialog

---

### Empty States

Design empty states as small moments of delight:

**No applicants yet:**
- Icon: stylized person silhouette in dept color
- Heading: "No applicants yet"
- Subtext: "Start by adding a new applicant for [Department Name]."
- Button: "Add First Applicant"

**No template uploaded:**
- Icon: ID card outline, dashed
- Heading: "No ID template configured"
- Subtext: "Upload a template image to enable ID generation for your department."
- Button (admin only): "Upload Template"

**Audit log — no results:**
- Icon: magnifying glass
- Heading: "No activity found"
- Subtext: "Try adjusting your date range or filter criteria."

---

## IMPLEMENTATION NOTES FOR CLAUDE CODE

### Tailwind Setup (v4)

> ⚠️ This project uses **Tailwind CSS v4** via `@tailwindcss/vite`. There is **NO `tailwind.config.js`**.
> All theme customization goes in `index.css` using `@theme {}` blocks.

```css
/* index.css — all custom tokens go here */
@import "tailwindcss";

@theme {
  --font-serif: 'DM Serif Display', Georgia, serif;
  --font-sans: 'DM Sans', system-ui, sans-serif;

  --animate-fade-up: fade-up 300ms ease-out both;
  --animate-slide-in: slide-in-right 300ms ease-out both;
  --animate-id-appear: id-appear 500ms cubic-bezier(0.175,0.885,0.32,1.275) both;
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes id-appear {
  from { opacity: 0; transform: translateY(30px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
```

### CSS Variables in index.css

```css
/* Add all --color-* variables in :root as shown in Section 3 */
/* Department classes (.dept-pwd, etc.) go in index.css */
/* Apply dept class to <body> or to the sidebar root element */
```

### Component Library Choice

Use **shadcn/ui** for:
- Dialog (modal)
- Select (dropdown with search)
- Tabs
- Tooltip
- Toast (Sonner)
- Calendar (date picker)
- Skeleton

Override shadcn's default colors with dept CSS variables in each component.

### Font Loading (index.html)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
```

---

*This document is the reference for all frontend implementation. Every page built in Claude Code should be checked against Section 3 (colors), Section 4 (typography), and Section 10 (UX guidelines) before considering it complete.*