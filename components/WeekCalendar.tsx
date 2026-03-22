"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, type Availability } from "@/lib/supabase";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22
const MEMBERS = ["David", "Jakob", "Julius", "Felix (J)", "Felix (H)"];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function slotKey(date: Date, hour: number): string {
  return `${formatDate(date)}_${String(hour).padStart(2, "0")}`;
}

function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hourStr] = key.split("_");
  return { date, hour: parseInt(hourStr, 10) };
}

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function heatmapColor(count: number, isCurrentUser: boolean) {
  const base =
    count === 0 ? "bg-slate-100"
    : count === 1 ? "bg-green-100"
    : count === 2 ? "bg-green-300"
    : count < 5  ? "bg-green-500"
    : "bg-green-700";
  return `${base}${isCurrentUser ? " ring-2 ring-blue-500 ring-inset" : ""}`;
}

function generateICS(slot: string) {
  const { date, hour } = parseSlotKey(slot);
  const [y, m, d] = date.split("-").map(Number);
  const p = (n: number) => String(n).padStart(2, "0");
  return [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//PapicinosPlanning//EN",
    "BEGIN:VEVENT",
    `UID:papicinos-${slot}@papicinosplanning`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").slice(0,15)}Z`,
    `DTSTART:${y}${p(m)}${p(d)}T${p(hour)}0000`,
    `DTEND:${y}${p(m)}${p(d)}T${p(hour+1)}0000`,
    "SUMMARY:Papicinos Treffen",
    "END:VEVENT","END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(slot: string) {
  const blob = new Blob([generateICS(slot)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `papicinos-${slot}.ics`; a.click();
  URL.revokeObjectURL(url);
}

type WeekComment = { user_name: string; week_start: string; comment: string };
type ConfirmedEvent = { id: string; week_start: string; slot_key: string; confirmed_by: string };
type LocationSuggestion = { id: string; week_start: string; location: string; suggested_by: string };
type LocationVote = { id: string; suggestion_id: string; user_name: string };

// ─────────────────────────────────────────────────────────────────────────────

export default function WeekCalendar({ currentUser }: { currentUser: string }) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [allSlots, setAllSlots]   = useState<Map<string, Set<string>>>(new Map());
  const [mySlots,  setMySlots]    = useState<Set<string>>(new Set());
  const [viewUser, setViewUser]   = useState<string | null>(null);
  const [allUsers, setAllUsers]   = useState<string[]>([]);
  const [comments,      setComments]      = useState<WeekComment[]>([]);
  const [myComment,     setMyComment]     = useState("");
  const [editingComment,setEditingComment]= useState(false);
  const [draftComment,  setDraftComment]  = useState("");

  // New state
  const [confirmedEvent, setConfirmedEvent] = useState<ConfirmedEvent | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [locationVotes, setLocationVotes] = useState<LocationVote[]>([]);
  const [newLocation, setNewLocation] = useState("");

  const dragging      = useRef(false);
  const dragMode      = useRef<"add"|"remove">("add");
  const pendingToggle = useRef<Set<string>>(new Set());
  const weekKey = formatDate(weekStart);

  const [infoSlot, setInfoSlot] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const { data, error } = await supabase.from("availabilities").select("user_name, slot_key");
    if (error) { console.error(error); return; }
    const map = new Map<string, Set<string>>();
    const users = new Set<string>();
    for (const row of data as Pick<Availability,"user_name"|"slot_key">[]) {
      users.add(row.user_name);
      if (!map.has(row.slot_key)) map.set(row.slot_key, new Set());
      map.get(row.slot_key)!.add(row.user_name);
    }
    setAllSlots(map);
    setAllUsers(Array.from(users).sort());
    const mine = new Set<string>();
    map.forEach((u, k) => { if (u.has(currentUser)) mine.add(k); });
    setMySlots(mine);
  }, [currentUser]);

  const loadComments = useCallback(async () => {
    setComments([]); setMyComment(""); setDraftComment(""); setEditingComment(false);
    const { data, error } = await supabase
      .from("week_comments").select("user_name,week_start,comment").eq("week_start", weekKey);
    if (error) { console.error(error); return; }
    const rows = (data ?? []) as WeekComment[];
    setComments(rows);
    const mine = rows.find(r => r.user_name === currentUser);
    if (mine) { setMyComment(mine.comment); setDraftComment(mine.comment); }
  }, [currentUser, weekKey]);

  const loadConfirmedEvent = useCallback(async () => {
    const { data, error } = await supabase
      .from("confirmed_events").select("*").eq("week_start", weekKey).maybeSingle();
    if (error) { setConfirmedEvent(null); return; }
    setConfirmedEvent(data);
  }, [weekKey]);

  const loadLocations = useCallback(async () => {
    const { data: suggestions, error } = await supabase
      .from("location_suggestions").select("*").eq("week_start", weekKey);
    if (error) { setLocationSuggestions([]); setLocationVotes([]); return; }
    setLocationSuggestions(suggestions ?? []);
    if (suggestions?.length) {
      const ids = suggestions.map(s => s.id);
      const { data: votes } = await supabase
        .from("location_votes").select("*").in("suggestion_id", ids);
      setLocationVotes(votes ?? []);
    } else {
      setLocationVotes([]);
    }
  }, [weekKey]);

  useEffect(() => { loadAll(); },             [loadAll]);
  useEffect(() => { loadComments(); },        [loadComments]);
  useEffect(() => { loadConfirmedEvent(); },  [loadConfirmedEvent]);
  useEffect(() => { loadLocations(); },       [loadLocations]);

  useEffect(() => {
    const ch = supabase.channel("rt")
      .on("postgres_changes", { event:"*", schema:"public", table:"availabilities" },      () => loadAll())
      .on("postgres_changes", { event:"*", schema:"public", table:"week_comments" },       () => loadComments())
      .on("postgres_changes", { event:"*", schema:"public", table:"confirmed_events" },    () => loadConfirmedEvent())
      .on("postgres_changes", { event:"*", schema:"public", table:"location_suggestions" },() => loadLocations())
      .on("postgres_changes", { event:"*", schema:"public", table:"location_votes" },      () => loadLocations())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAll, loadComments, loadConfirmedEvent, loadLocations]);

  // ── Slots ─────────────────────────────────────────────────────────────────

  async function addSlot(key: string) {
    setMySlots(p => new Set([...p, key]));
    setAllSlots(p => {
      const n = new Map(p);
      if (!n.has(key)) n.set(key, new Set());
      n.get(key)!.add(currentUser); return n;
    });
    await supabase.from("availabilities").upsert({ user_name: currentUser, slot_key: key });
  }

  async function removeSlot(key: string) {
    setMySlots(p => { const n = new Set(p); n.delete(key); return n; });
    setAllSlots(p => { const n = new Map(p); n.get(key)?.delete(currentUser); return n; });
    await supabase.from("availabilities").delete().eq("user_name", currentUser).eq("slot_key", key);
  }

  function handleMouseDown(key: string) {
    dragging.current = true;
    dragMode.current = mySlots.has(key) ? "remove" : "add";
    pendingToggle.current = new Set([key]);
    dragMode.current === "add" ? addSlot(key) : removeSlot(key);
  }
  function handleMouseEnter(key: string) {
    setInfoSlot(key);
    if (!dragging.current || pendingToggle.current.has(key)) return;
    pendingToggle.current.add(key);
    dragMode.current === "add" ? addSlot(key) : removeSlot(key);
  }
  function handleMouseUp() { dragging.current = false; pendingToggle.current.clear(); }

  function handleTouchEnd(e: React.TouchEvent, key: string) {
    e.preventDefault();
    setInfoSlot(key);
    mySlots.has(key) ? removeSlot(key) : addSlot(key);
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async function saveComment() {
    const text = draftComment.trim();
    if (!text) {
      await supabase.from("week_comments").delete().eq("user_name", currentUser).eq("week_start", weekKey);
      setMyComment("");
    } else {
      await supabase.from("week_comments").upsert({ user_name: currentUser, week_start: weekKey, comment: text });
      setMyComment(text);
    }
    setEditingComment(false);
    loadComments();
  }

  async function deleteComment() {
    await supabase.from("week_comments").delete().eq("user_name", currentUser).eq("week_start", weekKey);
    setMyComment(""); setDraftComment(""); setEditingComment(false);
    loadComments();
  }

  // ── Event Confirmation ────────────────────────────────────────────────────

  async function confirmEvent(sk: string) {
    await supabase.from("confirmed_events").upsert({ week_start: weekKey, slot_key: sk, confirmed_by: currentUser });
    loadConfirmedEvent();
  }

  async function cancelEvent() {
    await supabase.from("confirmed_events").delete().eq("week_start", weekKey);
    setConfirmedEvent(null);
  }

  // ── Location Suggestions ─────────────────────────────────────────────────

  async function addLocationSuggestion() {
    const text = newLocation.trim();
    if (!text) return;
    // Check if user already has a suggestion this week
    const existing = locationSuggestions.find(s => s.suggested_by === currentUser);
    if (existing) {
      await supabase.from("location_suggestions").update({ location: text }).eq("id", existing.id);
    } else {
      await supabase.from("location_suggestions").insert({ week_start: weekKey, location: text, suggested_by: currentUser });
    }
    setNewLocation("");
    loadLocations();
  }

  async function toggleLocationVote(suggestionId: string) {
    const existing = locationVotes.find(v => v.suggestion_id === suggestionId && v.user_name === currentUser);
    if (existing) {
      await supabase.from("location_votes").delete().eq("id", existing.id);
    } else {
      await supabase.from("location_votes").insert({ suggestion_id: suggestionId, user_name: currentUser });
    }
    loadLocations();
  }

  async function deleteLocationSuggestion(id: string) {
    await supabase.from("location_suggestions").delete().eq("id", id);
    loadLocations();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const bestSlot = (() => {
    let best: string | null = null, bestCount = 0;
    allSlots.forEach((u, k) => { if (u.size > bestCount) { bestCount = u.size; best = k; } });
    return best ? { key: best, count: bestCount } : null;
  })();

  const weekDays    = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today       = formatDate(new Date());
  const currentWeekStart = getWeekStart(new Date());
  const isPastWeek  = weekStart < currentWeekStart;
  const isFutureWeek = weekStart > currentWeekStart;

  // Wer fehlt noch?
  const weekDates = weekDays.map(d => formatDate(d));
  const membersWithSlots = new Set<string>();
  allSlots.forEach((users, key) => {
    const slotDate = key.split("_")[0];
    if (weekDates.includes(slotDate)) {
      users.forEach(u => membersWithSlots.add(u));
    }
  });
  const missingMembers = MEMBERS.filter(m => !membersWithSlots.has(m));

  // Votes per suggestion
  function votesForSuggestion(id: string) {
    return locationVotes.filter(v => v.suggestion_id === id);
  }
  function hasVoted(suggestionId: string) {
    return locationVotes.some(v => v.suggestion_id === suggestionId && v.user_name === currentUser);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="px-3 py-3 sm:px-5 sm:py-4 max-w-6xl mx-auto"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ═══ CONTROLS BAR ═══════════════════════════════════════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">

        {/* Week navigation */}
        <div className="flex items-center gap-1 bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-sm px-2 py-1.5 self-start sm:self-auto">
          <button
            onClick={() => setWeekStart(w => addDays(w, -7))}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 text-lg font-bold transition-colors"
          >‹</button>
          <div className="text-center px-2 min-w-[160px]">
            <span className="text-sm font-semibold text-slate-800">
              {weekStart.toLocaleDateString("de-DE", { month: "short", day: "numeric" })}
              {" – "}
              {addDays(weekStart, 6).toLocaleDateString("de-DE", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            {isPastWeek && (
              <div className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-0.5 leading-tight">
                Vergangene Woche
              </div>
            )}
            {isFutureWeek && (
              <div className="text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 mt-0.5 leading-tight">
                Kommende Woche
              </div>
            )}
          </div>
          <button
            onClick={() => setWeekStart(w => addDays(w, 7))}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 text-lg font-bold transition-colors"
          >›</button>
          <div className="w-px h-5 bg-slate-200 mx-1" />
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="text-xs font-semibold text-blue-600 hover:bg-blue-50 active:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
          >Heute</button>
        </div>

        {/* User filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          <button
            onClick={() => setViewUser(null)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              viewUser === null
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white/90 text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
            }`}
          >Alle</button>
          {allUsers.map(u => (
            <button key={u}
              onClick={() => setViewUser(viewUser === u ? null : u)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                viewUser === u
                  ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                  : "bg-white/90 text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
              }`}
            >{u}</button>
          ))}
        </div>
      </div>

      {/* ═══ WER FEHLT NOCH ════════════════════════════════════════════════ */}
      {missingMembers.length > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-2.5 shadow-sm">
          <div className="w-8 h-8 rounded-xl bg-orange-400 flex items-center justify-center shrink-0 text-sm">
            👀
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
              {missingMembers.length === MEMBERS.length ? "Noch keiner hat Zeiten eingetragen 👀" : "Haben noch nichts eingetragen:"}
            </p>
            <p className="text-sm font-bold text-orange-900 truncate">
              {missingMembers.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* ═══ CONFIRMED EVENT BANNER ════════════════════════════════════════ */}
      {confirmedEvent ? (
        <ConfirmedEventBanner
          event={confirmedEvent}
          allSlots={allSlots}
          onCancel={cancelEvent}
        />
      ) : (
        bestSlot && (
          <BestSlotBanner
            slot={bestSlot.key}
            count={bestSlot.count}
            onConfirm={() => confirmEvent(bestSlot.key)}
          />
        )
      )}

      {/* ═══ LEGEND ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">Wer kann:</span>
        {([
          ["bg-slate-100 border border-slate-300", "0"],
          ["bg-green-100", "1"],
          ["bg-green-300", "2"],
          ["bg-green-500", "3–4"],
          ["bg-green-700", "5+"],
        ] as [string,string][]).map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm ${cls}`} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-100 ring-2 ring-blue-500 ring-inset" />
          Deine Auswahl
        </span>
      </div>

      {/* ═══ MAIN LAYOUT ═════════════════════════════════════════════════════ */}
      <div className="flex flex-col lg:flex-row gap-3 items-start">

        {/* ── Calendar ─────────────────────────────────────────────────── */}
        <div className={`flex-1 min-w-0 overflow-x-auto rounded-2xl border shadow-sm transition-colors ${isPastWeek ? "border-amber-200 opacity-75" : "border-slate-200"}`}>
          <div className="bg-white min-w-[540px] no-select" style={{ userSelect: "none" }}>

            {/* Day headers */}
            <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
              <div className="border-b border-r border-slate-200 bg-slate-50/80" />
              {weekDays.map((day, i) => {
                const isToday = formatDate(day) === today;
                const isWeekend = i >= 5;
                return (
                  <div key={i} className={`border-b border-r last:border-r-0 border-slate-200 py-2.5 text-center
                    ${isToday ? "bg-blue-50" : isWeekend ? "bg-slate-50/60" : "bg-slate-50/80"}`}>
                    <div className={`text-[10px] font-bold uppercase tracking-widest
                      ${isToday ? "text-blue-500" : "text-slate-400"}`}>
                      {WEEKDAY_SHORT[i]}
                    </div>
                    <div className={`text-sm font-bold mt-0.5
                      ${isToday
                        ? "bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center mx-auto text-xs"
                        : isWeekend ? "text-slate-500" : "text-slate-700"}`}>
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hour rows */}
            {HOURS.map((hour) => (
              <div key={hour} className="grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
                <div className="border-b border-r border-slate-300 bg-slate-50/60 flex items-center justify-end pr-2">
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {String(hour).padStart(2,"0")}:00
                  </span>
                </div>
                {weekDays.map((day, di) => {
                  const key = slotKey(day, hour);
                  const usersInSlot = allSlots.get(key) ?? new Set<string>();
                  const count  = usersInSlot.size;
                  const isMine = mySlots.has(key);
                  const isBest = bestSlot?.key === key;
                  const isConfirmed = confirmedEvent?.slot_key === key;
                  const isWeekend = di >= 5;

                  let cellClass: string;
                  if (viewUser) {
                    const has = usersInSlot.has(viewUser);
                    cellClass = has
                      ? viewUser === currentUser
                        ? "bg-blue-200 ring-2 ring-blue-500 ring-inset"
                        : "bg-violet-200"
                      : "bg-slate-50";
                  } else {
                    cellClass = heatmapColor(count, isMine);
                    if (count === 0 && isWeekend) cellClass = "bg-slate-50/70";
                  }

                  return (
                    <div key={di}
                      title={count > 0
                        ? `${count} verfügbar: ${Array.from(usersInSlot).join(", ")}`
                        : "Niemand verfügbar"}
                      className={`border-b border-r last:border-r-0 border-slate-300 h-9 cursor-pointer
                        transition-colors relative select-none
                        ${cellClass}
                        ${formatDate(day) === today ? "border-l-2 border-l-blue-300" : ""}
                        ${isConfirmed && !viewUser ? "ring-2 ring-emerald-500 ring-inset z-10" : ""}
                        ${isBest && !isConfirmed && !viewUser ? "ring-1 ring-amber-400 ring-inset z-10" : ""}
                      `}
                      onMouseDown={() => handleMouseDown(key)}
                      onMouseEnter={() => handleMouseEnter(key)}
                      onTouchEnd={e => handleTouchEnd(e, key)}
                    >
                      {isConfirmed && !viewUser && (
                        <span className="absolute top-0 right-0 text-[8px] leading-none bg-emerald-500 text-white px-0.5 rounded-bl font-bold z-10">📌</span>
                      )}
                      {isBest && !isConfirmed && !viewUser && count > 0 && (
                        <span className="absolute top-0 right-0 text-[8px] leading-none bg-amber-400 text-amber-900 px-0.5 rounded-bl font-bold z-10">★</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <div className="w-full lg:w-72 lg:shrink-0 space-y-3">

          {/* ── Notes panel ──────────────────────────────────────────── */}
          <div className="bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-700">Was ist bei dir los?</h2>
              <p className="text-xs text-slate-400 mt-0.5">Schreib kurz was du die Woche so hast</p>
            </div>

            <div className="p-4">
              {editingComment ? (
                <div>
                  <textarea
                    value={draftComment}
                    onChange={e => setDraftComment(e.target.value)}
                    placeholder="z.B. die Woche kacke viel Arbeit, Fr/Sa bin ich aber frei…"
                    rows={4}
                    maxLength={300}
                    autoFocus
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-slate-50 leading-relaxed"
                  />
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={saveComment}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl py-2 transition-colors shadow-sm">
                      Speichern
                    </button>
                    <button onClick={() => { setEditingComment(false); setDraftComment(myComment); }}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold rounded-xl py-2 transition-colors">
                      Abbrechen
                    </button>
                  </div>
                  {myComment && (
                    <button onClick={deleteComment}
                      className="mt-2 w-full text-xs text-red-400 hover:text-red-600 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      Notiz löschen
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {myComment ? (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-xs font-bold text-blue-700">{currentUser}</span>
                          <span className="text-xs text-blue-400">(du)</span>
                        </div>
                        <button
                          onClick={() => { setEditingComment(true); setDraftComment(myComment); }}
                          className="text-xs text-blue-400 hover:text-blue-600 font-semibold px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors">
                          Bearbeiten
                        </button>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{myComment}</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingComment(true); setDraftComment(""); }}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-blue-300 text-slate-400 hover:text-blue-500 text-sm font-medium rounded-xl py-3.5 transition-all active:bg-blue-50">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Notiz hinzufügen
                    </button>
                  )}

                  {comments.filter(c => c.user_name !== currentUser).map(c => (
                    <div key={c.user_name} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-2 h-2 rounded-full bg-violet-400" />
                        <span className="text-xs font-bold text-slate-600">{c.user_name}</span>
                      </div>
                      <p className="text-sm text-slate-500 leading-relaxed whitespace-pre-wrap">{c.comment}</p>
                    </div>
                  ))}

                  {comments.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">Noch hat keiner was geschrieben</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Location Suggestions ─────────────────────────────────── */}
          {confirmedEvent && (
            <div className="bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-700">📍 Wo treffen wir uns?</h2>
                <p className="text-xs text-slate-400 mt-0.5">Ideen rein, abstimmen, fertig</p>
              </div>

              <div className="p-4 space-y-2.5">
                {/* Suggestions sorted by votes */}
                {[...locationSuggestions]
                  .sort((a, b) => votesForSuggestion(b.id).length - votesForSuggestion(a.id).length)
                  .map(s => {
                    const votes = votesForSuggestion(s.id);
                    const voted = hasVoted(s.id);
                    const isMine = s.suggested_by === currentUser;
                    return (
                      <div key={s.id} className={`rounded-xl border p-3 transition-colors ${
                        voted ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-100"
                      }`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-700 truncate">{s.location}</p>
                            <p className="text-[10px] text-slate-400">von {s.suggested_by}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => toggleLocationVote(s.id)}
                              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                                voted
                                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                  : "bg-white text-slate-500 border border-slate-200 hover:border-emerald-300 hover:text-emerald-600"
                              }`}
                            >
                              👍 {votes.length}
                            </button>
                            {isMine && (
                              <button
                                onClick={() => deleteLocationSuggestion(s.id)}
                                className="text-xs text-slate-300 hover:text-red-400 transition-colors p-1"
                                title="Vorschlag löschen"
                              >✕</button>
                            )}
                          </div>
                        </div>
                        {votes.length > 0 && (
                          <p className="text-[10px] text-slate-400 mt-1.5">
                            {votes.map(v => v.user_name).join(", ")}
                          </p>
                        )}
                      </div>
                    );
                  })
                }

                {/* Add suggestion */}
                {!locationSuggestions.find(s => s.suggested_by === currentUser) ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newLocation}
                      onChange={e => setNewLocation(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addLocationSuggestion()}
                      placeholder="Ort vorschlagen…"
                      maxLength={100}
                      className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
                    />
                    <button
                      onClick={addLocationSuggestion}
                      disabled={!newLocation.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl px-3 py-2 transition-colors shadow-sm"
                    >+</button>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400 text-center">Du hast schon einen Ort vorgeschlagen. Lösch ihn wenn du einen anderen willst.</p>
                )}

                {locationSuggestions.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-1">Noch keine Ideen — los jetzt</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ SLOT INFO BAR ═══════════════════════════════════════════════════ */}
      <div className="mt-3 h-10 flex items-center justify-center">
        {infoSlot ? (
          <SlotInfoBar slotKey={infoSlot} allSlots={allSlots} currentUser={currentUser} />
        ) : (
          <p className="text-xs text-slate-500 bg-white/80 backdrop-blur rounded-full py-1.5 px-5 shadow-sm border border-slate-100">
            Ziehen zum Auswählen · Antippen um zu sehen wer kann
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Slot Info Bar ────────────────────────────────────────────────────────────

function SlotInfoBar({
  slotKey, allSlots, currentUser,
}: {
  slotKey: string;
  allSlots: Map<string, Set<string>>;
  currentUser: string;
}) {
  const { date, hour } = parseSlotKey(slotKey);
  const dateObj = new Date(`${date}T00:00:00`);
  const dayLabel = dateObj.toLocaleDateString("de-DE", { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = `${String(hour).padStart(2,"0")}:00`;
  const usersInSlot = allSlots.get(slotKey) ?? new Set<string>();
  const count = usersInSlot.size;
  const names = Array.from(usersInSlot);

  return (
    <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur rounded-full py-2 px-4 shadow-sm border border-slate-200 text-xs">
      <span className="font-semibold text-slate-600">{dayLabel} · {timeLabel}</span>
      <span className="w-px h-3.5 bg-slate-300" />
      {count === 0 ? (
        <span className="text-slate-400">Niemand verfügbar</span>
      ) : (
        <span className="text-slate-600">
          <span className="font-semibold text-green-600">{count} verfügbar: </span>
          {names.map((name, i) => (
            <span key={name}>
              <span className={name === currentUser ? "font-bold text-blue-600" : "text-slate-700"}>
                {name}
              </span>
              {i < names.length - 1 && <span className="text-slate-400">, </span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// ─── Best Slot Banner ─────────────────────────────────────────────────────────

function BestSlotBanner({ slot, count, onConfirm }: { slot: string; count: number; onConfirm: () => void }) {
  const { date, hour } = parseSlotKey(slot);
  const dateObj  = new Date(`${date}T00:00:00`);
  const dayLabel = dateObj.toLocaleDateString("de-DE", { weekday: "long", month: "short", day: "numeric" });
  const timeLabel = `${String(hour).padStart(2,"0")}:00 – ${String(hour+1).padStart(2,"0")}:00`;

  return (
    <div className="mb-3 flex items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-amber-400 flex items-center justify-center shrink-0 text-sm">★</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Da können die meisten</p>
          <p className="text-sm font-bold text-amber-900 truncate">{dayLabel}</p>
          <p className="text-xs text-amber-700">{timeLabel} · {count} {count === 1 ? "Person" : "Personen"}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onConfirm}
          className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-colors shadow-sm whitespace-nowrap"
        >
          📌 Bestätigen
        </button>
        <button
          onClick={() => downloadICS(slot)}
          className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-amber-900 font-bold text-xs px-3.5 py-2 rounded-xl transition-colors shadow-sm whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          In Kalender
        </button>
      </div>
    </div>
  );
}

// ─── Confirmed Event Banner ───────────────────────────────────────────────────

function ConfirmedEventBanner({
  event, allSlots, onCancel,
}: {
  event: ConfirmedEvent;
  allSlots: Map<string, Set<string>>;
  onCancel: () => void;
}) {
  const { date, hour } = parseSlotKey(event.slot_key);
  const dateObj  = new Date(`${date}T00:00:00`);
  const dayLabel = dateObj.toLocaleDateString("de-DE", { weekday: "long", month: "short", day: "numeric" });
  const timeLabel = `${String(hour).padStart(2,"0")}:00 – ${String(hour+1).padStart(2,"0")}:00`;
  const attendees = allSlots.get(event.slot_key) ?? new Set<string>();

  return (
    <div className="mb-3 flex items-center justify-between gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 text-sm text-white">📌</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-0.5">Läuft. Termin steht.</p>
          <p className="text-sm font-bold text-emerald-900 truncate">{dayLabel}</p>
          <p className="text-xs text-emerald-700">{timeLabel} · {attendees.size} {attendees.size === 1 ? "Person" : "Personen"} dabei</p>
          <p className="text-[10px] text-emerald-500 mt-0.5">{event.confirmed_by} hat den Termin gesetzt</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => downloadICS(event.slot_key)}
          className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-colors shadow-sm whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          In Kalender
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-400 hover:text-red-600 border border-red-200 font-bold text-xs px-3.5 py-2 rounded-xl transition-colors shadow-sm whitespace-nowrap"
        >
          Absagen
        </button>
      </div>
    </div>
  );
}
