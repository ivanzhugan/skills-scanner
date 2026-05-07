import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppState, HealthFinding, Skill, SkillCategory } from "@skillset/shared";
import "./styles.css";

type ConnectionState = "connecting" | "connected" | "disconnected";
type LibraryFilter = "all" | "visible" | "quiet" | "broken" | "scripted" | "no-profile";
type CategoryFilter = "All categories" | SkillCategory;

const filters: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "visible", label: "Visible" },
  { id: "quiet", label: "Quiet" },
  { id: "broken", label: "Broken" },
  { id: "scripted", label: "Scripted" },
  { id: "no-profile", label: "No profile" }
];

function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [healthFindings, setHealthFindings] = useState<HealthFinding[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>("all");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All categories");
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const refresh = () => {
      void Promise.all([
        fetch("/api/state").then((response) => response.json() as Promise<AppState>),
        fetch("/api/skills").then((response) => response.json() as Promise<Skill[]>),
        fetch("/api/health").then((response) => response.json() as Promise<HealthFinding[]>)
      ])
        .then(([nextState, nextSkills, nextHealthFindings]) => {
          setAppState(nextState);
          setSkills(nextSkills);
          setHealthFindings(nextHealthFindings);
          setSelectedSkillId((current) => current ?? nextSkills[0]?.id ?? null);
        })
        .catch(() => setConnection("disconnected"));
    };

    refresh();

    const events = new EventSource("/api/events");
    events.addEventListener("open", () => setConnection("connected"));
    events.addEventListener("connection.open", () => setConnection("connected"));
    events.addEventListener("scan.completed", refresh);
    events.addEventListener("skills.changed", refresh);
    events.addEventListener("health.changed", refresh);
    events.onerror = () => setConnection("disconnected");

    return () => {
      events.close();
    };
  }, []);

  const statusCopy = useMemo(() => {
    if (connection === "connected") {
      return "Live - Watching personal and project skill folders";
    }
    if (connection === "connecting") {
      return "Connecting to local SkillSet server";
    }
    return "Disconnected - local updates are paused";
  }, [connection]);
  const filterCounts = useMemo(() => buildFilterCounts(skills), [skills]);
  const categoryCounts = useMemo(() => buildCategoryCounts(skills), [skills]);
  const categories = useMemo(
    () => [...categoryCounts.entries()].sort((first, second) => second[1] - first[1]),
    [categoryCounts]
  );
  const filteredSkills = useMemo(
    () =>
      skills
        .filter((skill) => matchesCategory(skill, activeCategory))
        .filter((skill) => matchesFilter(skill, activeFilter))
        .filter((skill) => matchesQuery(skill, query)),
    [activeCategory, activeFilter, query, skills]
  );
  const groupedSkills = useMemo(() => groupSkillsByCategory(filteredSkills), [filteredSkills]);
  const selectedSkill =
    skills.find((skill) => skill.id === selectedSkillId) ??
    skills.find((skill) => skill.id === selectedSkillId) ??
    null;

  const refresh = () => {
    void Promise.all([
      fetch("/api/state").then((response) => response.json() as Promise<AppState>),
      fetch("/api/skills").then((response) => response.json() as Promise<Skill[]>),
      fetch("/api/health").then((response) => response.json() as Promise<HealthFinding[]>)
    ]).then(([nextState, nextSkills, nextHealthFindings]) => {
      setAppState(nextState);
      setSkills(nextSkills);
      setHealthFindings(nextHealthFindings);
      setSelectedSkillId((current) => current ?? nextSkills[0]?.id ?? null);
    });
  };

  const setVisibility = async (skill: Skill, visibility: Skill["visibility"]) => {
    const action = visibility === "visible" ? "make visible" : "make quiet";
    const confirmed = window.confirm(
      `${action[0].toUpperCase()}${action.slice(1)}: ${skill.displayName}\n\nThis changes SkillSet's manifest state only. Original skill folder preserved:\n${skill.originalPath}`
    );
    if (!confirmed) {
      return;
    }
    await fetch(`/api/skills/${encodeURIComponent(skill.id)}/visibility`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility })
    });
    refresh();
  };

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="SkillSet sections">
        <div className="brand">SkillSet</div>
        <nav>
          <a className="active" href="#library">Library</a>
          <a href="#health">Health</a>
          <a href="#profiles">Profiles</a>
        </nav>
      </aside>

      <section className="workspace">
        <div className={`live live-${connection}`}>
          <span aria-hidden="true" />
          {statusCopy}
        </div>

        <section className="panel" id="library">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Library</p>
              <h1>Installed skills, ready for review.</h1>
              <p className="subcopy">
                Installed does not always mean visible. This local app will show which skills Claude can see and why each one should stay active.
              </p>
            </div>
            <label className="search">
              <span>Search skills</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, description, file, or profile"
                value={query}
              />
            </label>
          </div>

          <div className="summaryGrid">
            <div>
              <strong>{appState?.skillCount ?? skills.length}</strong>
              <span>Installed skills</span>
            </div>
            <div>
              <strong>{appState?.healthFindingCount ?? healthFindings.length}</strong>
              <span>Health findings</span>
            </div>
            <div>
              <strong>{appState ? appState.roots.length : 0}</strong>
              <span>Watched roots</span>
            </div>
          </div>

          <div className="filterBar" aria-label="Library filters">
            {filters.map((filter) => (
              <button
                className={filter.id === activeFilter ? "filterChip active" : "filterChip"}
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                type="button"
              >
                {filter.label}
                <span>{filterCounts[filter.id]}</span>
              </button>
            ))}
          </div>

          <div className="categoryBar" aria-label="Skill categories">
            <button
              className={activeCategory === "All categories" ? "categoryChip active" : "categoryChip"}
              onClick={() => setActiveCategory("All categories")}
              type="button"
            >
              All categories
              <span>{skills.length}</span>
            </button>
            {categories.map(([category, count]) => (
              <button
                className={activeCategory === category ? "categoryChip active" : "categoryChip"}
                key={category}
                onClick={() => setActiveCategory(category)}
                type="button"
              >
                {category}
                <span>{count}</span>
              </button>
            ))}
          </div>

          <div className="libraryFull">
            <div className="skillTable">
              <div className="tableHeader">
                <span>Skill</span>
                <span>Category</span>
                <span>When Claude may use it</span>
                <span>State</span>
              </div>
              {filteredSkills.length === 0 ? (
                <div className="emptyState">
                  <strong>{skills.length === 0 ? "No skills found yet." : "No skills match this view."}</strong>
                  <span>
                    {skills.length === 0
                      ? "Create a folder with `SKILL.md` in one watched root and it will appear here."
                      : "Try a different search or filter. The Library is filtering locally as you type."}
                  </span>
                </div>
              ) : (
                groupedSkills.map(([category, categorySkills]) => (
                  <React.Fragment key={category}>
                    {activeCategory === "All categories" ? (
                      <div className="categoryDivider">
                        <span>{category}</span>
                        <strong>{categorySkills.length}</strong>
                      </div>
                    ) : null}
                    {categorySkills.map((skill) => (
                      <button
                        className={skill.id === selectedSkill?.id && drawerOpen ? "tableRow selected" : "tableRow"}
                        key={skill.id}
                        type="button"
                        onClick={() => {
                          setSelectedSkillId(skill.id);
                          setDrawerOpen(true);
                        }}
                      >
                        <span className="skillCell">
                          <strong>{skill.displayName}</strong>
                          <small>{skill.originalPath}</small>
                        </span>
                        <span className="categoryCell">{skill.category}</span>
                        <span className="triggerCell">{primaryTrigger(skill)}</span>
                        <span className="rowTags">
                          <span className={skill.visibility === "visible" ? "rowMeta ok" : "rowMeta quiet"}>
                            {skill.visibility === "visible" ? "Visible" : "Quiet"}
                          </span>
                          {skill.riskLabels.length > 0 ? <span className="rowMeta risk">Scripted</span> : null}
                          {skill.healthFindings.length > 0 ? <span className="rowMeta warn">{skill.healthFindings.length} findings</span> : null}
                        </span>
                      </button>
                    ))}
                  </React.Fragment>
                ))
              )}
            </div>
          </div>

          <div className="roots">
            {(appState?.roots ?? []).map((root) => (
              <article key={root.id}>
                <div>
                  <strong>{root.label}</strong>
                  <code>{root.path}</code>
                </div>
                <span className={root.exists ? "pill ok" : "pill muted"}>
                  {root.exists ? "Found" : "Not created yet"}
                </span>
              </article>
            ))}
          </div>
        </section>
      </section>

      {drawerOpen && selectedSkill ? (
        <div className="drawerLayer" role="presentation" onClick={() => setDrawerOpen(false)}>
          <aside className="drawer" role="dialog" aria-label={`${selectedSkill.displayName} details`} onClick={(event) => event.stopPropagation()}>
            <div className="drawerHeader">
              <div>
                <p className="eyebrow">Skill detail</p>
                <h2>{selectedSkill.displayName}</h2>
              </div>
              <button aria-label="Close skill detail" className="iconButton" onClick={() => setDrawerOpen(false)} type="button">
                x
              </button>
            </div>
            <p>{selectedSkill.description ?? "This skill does not define a description yet."}</p>

            <div className="stateStrip">
              <span className={selectedSkill.visibility === "visible" ? "state visible" : "state quiet"}>
                {selectedSkill.visibility === "visible" ? "Claude can see it" : "Quiet in SkillSet"}
              </span>
              <span className="state">{selectedSkill.category}</span>
              <span className="state">{selectedSkill.source}</span>
              {selectedSkill.profiles.length === 0 ? <span className="state warn">No profile</span> : null}
            </div>

            <DetailBlock title="When Claude may use it">
              {(selectedSkill.triggerPhrases.length > 0 ? selectedSkill.triggerPhrases : ["No trigger phrases detected yet."]).map((phrase) => (
                <span key={phrase}>{phrase}</span>
              ))}
            </DetailBlock>

            <DetailBlock title="Why keep it active">
              <span>{purposeCopy(selectedSkill)}</span>
            </DetailBlock>

            <DetailBlock title="Files and references">
              {selectedSkill.referencedFiles.length === 0 ? (
                <span>No local file references detected.</span>
              ) : (
                selectedSkill.referencedFiles.map((reference) => (
                  <span key={`${reference.kind}-${reference.path}`}>
                    {reference.path} · {reference.exists ? "found" : "missing"}
                  </span>
                ))
              )}
            </DetailBlock>

            <DetailBlock title="Risk signals">
              {selectedSkill.riskLabels.length === 0 ? (
                <span>No scripted or high-impact signals detected.</span>
              ) : (
                selectedSkill.riskLabels.map((label) => (
                  <span key={label.id}>
                    {label.label} · {label.evidence.join(", ")}
                  </span>
                ))
              )}
            </DetailBlock>

            <DetailBlock title="Health findings">
              {selectedSkill.healthFindings.length === 0 ? (
                <span>No health findings for this skill.</span>
              ) : (
                selectedSkill.healthFindings.slice(0, 20).map((finding) => (
                  <span key={finding.id}>
                    {finding.type} · {finding.message}
                  </span>
                ))
              )}
            </DetailBlock>

            <DetailBlock title="Location">
              <code>{selectedSkill.originalPath}</code>
            </DetailBlock>

            <div className="actions">
              <button
                disabled={selectedSkill.visibility === "visible"}
                onClick={() => void setVisibility(selectedSkill, "visible")}
                type="button"
              >
                Keep visible
              </button>
              <button
                disabled={selectedSkill.visibility === "quiet"}
                onClick={() => void setVisibility(selectedSkill, "quiet")}
                type="button"
              >
                Make quiet
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function DetailBlock({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="inspectorBlock">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function buildFilterCounts(skills: Skill[]): Record<LibraryFilter, number> {
  return {
    all: skills.length,
    visible: skills.filter((skill) => skill.visibility === "visible").length,
    quiet: skills.filter((skill) => skill.visibility === "quiet").length,
    broken: skills.filter((skill) => hasBrokenFinding(skill)).length,
    scripted: skills.filter((skill) => skill.riskLabels.length > 0).length,
    "no-profile": skills.filter((skill) => skill.profiles.length === 0).length
  };
}

function matchesFilter(skill: Skill, filter: LibraryFilter) {
  switch (filter) {
    case "visible":
      return skill.visibility === "visible";
    case "quiet":
      return skill.visibility === "quiet";
    case "broken":
      return hasBrokenFinding(skill);
    case "scripted":
      return skill.riskLabels.length > 0;
    case "no-profile":
      return skill.profiles.length === 0;
    case "all":
    default:
      return true;
  }
}

function matchesCategory(skill: Skill, category: CategoryFilter) {
  return category === "All categories" || skill.category === category;
}

function matchesQuery(skill: Skill, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    skill.displayName,
    skill.name,
    skill.description,
    skill.category,
    skill.visibility,
    skill.source,
    skill.originalPath,
    skill.skillMdPath,
    ...skill.triggerPhrases,
    ...skill.profiles,
    ...skill.referencedFiles.map((reference) => reference.path),
    ...skill.healthFindings.map((finding) => `${finding.type} ${finding.message} ${finding.evidence.join(" ")}`)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

function primaryTrigger(skill: Skill) {
  return skill.triggerPhrases[0] ?? skill.description ?? "No trigger phrase detected.";
}

function belongsText(skill: Skill) {
  if (skill.profiles.length > 0) {
    return skill.profiles.join(", ");
  }
  return `${skill.source} · no profile`;
}

function buildCategoryCounts(skills: Skill[]): Map<SkillCategory, number> {
  const counts = new Map<SkillCategory, number>();
  for (const skill of skills) {
    counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1);
  }
  return counts;
}

function groupSkillsByCategory(skills: Skill[]): Array<[SkillCategory, Skill[]]> {
  const grouped = new Map<SkillCategory, Skill[]>();
  for (const skill of [...skills].sort((first, second) => first.displayName.localeCompare(second.displayName))) {
    const existing = grouped.get(skill.category) ?? [];
    existing.push(skill);
    grouped.set(skill.category, existing);
  }
  return [...grouped.entries()].sort((first, second) => first[0].localeCompare(second[0]));
}

function hasBrokenFinding(skill: Skill) {
  return skill.healthFindings.some((finding) => finding.severity === "error" || finding.type === "missing-reference" || finding.type === "missing-script");
}

function purposeCopy(skill: Skill) {
  if (skill.description) {
    return skill.description;
  }
  if (skill.triggerPhrases.length > 0) {
    return skill.triggerPhrases[0];
  }
  return "No purpose statement was found in SKILL.md. This is a good candidate for cleanup before keeping it visible.";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
