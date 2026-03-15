"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, type Availability } from "@/lib/supabase";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function slotKey(date: Date, hour: number): string {
  return `${formatDate(date)}_${String(hour).padStart(2, "0")}`;
}

function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hourStr] = key.split("_");
  return { date, hour: parseInt(hourStr, 10) };
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatmapColor(count: number, isCurrentUser: boolean) {
  const base =
    count === 0 ? "bg-slate-100"
    : count === 1 ? "bg-green-100"
    : count === 2 ? "bg-green-300"
    : count < 5  ? "bg-green-500"
    : "bg-green-700";
  const outline = isCurrentUser ? "ring-2 ring-blue-500 ring-inset" : "";
  return `${base} ${outline}`;
}

function generateICS(slot: string): string {
  const { date, hour } = parseSlotKey(slot);
  const [year, month, day] = date.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dtStart = `${year}${pad(month)}${pad(day)}T${pad(hour)}0000`;
  const dtEnd   = `${year}${pad(month)}${pad(day)}T${pad(hour + 1)}0000`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PapicinosPlanning//EN",
    "BEGIN:VEVENT",
    `UID:papicinos-${slot}@papicinosplanning`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").slice(0,15)}Z`,
    `DTSTART:${dtStart}`, `DTEND:${dtEnd}`,
    "SUMMARY:Group Meeting (PapicinosPlanning)",
    "END:VEVENT", "END:VCALENDAR",
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeekCalendar({ currentUser }: { currentUser: string }) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [allSlots, setAllSlots]   = useState<Map<string, Set<string>>>(new Map());
  const [mySlots, setMySlots]     = useState<Set<string>>(new Set());
  const [viewUser, setViewUser]   = useState<string | null>(null);
  const [allUsers, setAllUsers]   = useState<string[]>([]);

  const [comments, setComments]           = useState<WeekComment[]>([]);
  const [myComment, setMyComment]         = useState("");
  const [editingComment, setEditingComment] = useState(false);
  const [draftComment, setDraftComment]   = useState("");

  const dragging      = useRef(false);
  const dragMode      = useRef<"add" | "remove">("add");
  const pendingToggle = useRef<Set<string>>(new Set());
  const weekKey = formatDate(weekStart);

  // ── Data loading ────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const { data, error } = await supabase.from("availabilities").select("user_name, slot_key");
    if (error) { console.error(error); return; }
    const map = new Map<string, Set<string>>();
    const users = new Set<string>();
    for (const row of data as Pick<Availability, "user_name" | "slot_key">[]) {
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
      .from("week_comments").select("user_name, week_start, comment").eq("week_start", weekKey);
    if (error) { console.error(error); return; }
    const rows = (data ?? []) as WeekComment[];
    setComments(rows);
    const mine = rows.find((r) => r.user_name === currentUser);
    if (mine) { setMyComment(mine.comment); setDraftComment(mine.comment); }
  }, [currentUser, weekKey]);

  useEffect(() => { loadAll(); },      [loadAll]);
  useEffect(() => { loadComments(); }, [loadComments]);

  useEffect(() => {
    const ch = supabase.channel("realtime-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "availabilities" },  () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "week_comments" }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAll, loadComments]);

  // ── Slot toggle ──────────────────────────────────────────────────────────

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

  // ── Mouse drag (desktop) ─────────────────────────────────────────────────

  function handleMouseDown(key: string) {
    dragging.current = true;
    dragMode.current = mySlots.has(key) ? "remove" : "add";
    pendingToggle.current = new Set([key]);
    if (dragMode.current === "add") addSlot(key); else removeSlot(key);
  }

  function handleMouseEnter(key: string) {
    if (!dragging.current || pendingToggle.current.has(key)) return;
    pendingToggle.current.add(key);
    if (dragMode.current === "add") addSlot(key); else removeSlot(key);
  }

  function handleMouseUp() { dragging.current = false; pendingToggle.current.clear(); }

  // ── Touch tap (mobile) ───────────────────────────────────────────────────

  function handleTouchEnd(e: React.TouchEvent, key: string) {
    e.preventDefault();
    if (mySlots.has(key)) removeSlot(key); else addSlot(key);
  }

  // ── Comments ─────────────────────────────────────────────────────────────

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const bestSlot = (() => {
    let best: string | null = null, bestCount = 0;
    allSlots.forEach((u, k) => { if (u.size > bestCount) { bestCount = u.size; best = k; } });
    return best ? { key: best, count: bestCount } : null;
  })();

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today    = formatDate(new Date());

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-3 py-3 sm:px-4 sm:py-4 max-w-7xl mx-auto"
      onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>

      {/* ── Week navigation ── */}
      <div className="flex items-center justify-between bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-sm px-3 py-2 mb-3">
        <button
          onClick={() => setWeekStart(w => addDays(w, -7))}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-200 text-xl font-bold transition-colors"
        >‹</button>

        <div className="text-center">
          <div className="text-sm font-semibold text-slate-800">
            {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" – "}
            {addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
          <div className="text-xs text-slate-400">
            {addDays(weekStart, 6).getFullYear()}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors mr-1"
          >Today</button>
          <button
            onClick={() => setWeekStart(w => addDays(w, 7))}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-200 text-xl font-bold transition-colors"
          >›</button>
        </div>
      </div>

      {/* ── View filter ── */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setViewUser(null)}
          className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
            viewUser === null
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white/90 text-slate-600 border-slate-200 hover:border-slate-300"
          }`}
        >Everyone</button>
        {allUsers.map(u => (
          <button key={u}
            onClick={() => setViewUser(viewUser === u ? null : u)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
              viewUser === u
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-white/90 text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >{u}</button>
        ))}
      </div>

      {/* ── Best slot banner ── */}
      {bestSlot && <BestSlotBanner slot={bestSlot.key} count={bestSlot.count} />}

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-xs text-slate-500 bg-white/80 rounded-xl px-3 py-2">
        <span className="font-medium text-slate-600">Availability:</span>
        {([["bg-slate-100","0"],["bg-green-100","1"],["bg-green-300","2"],["bg-green-500","3–4"],["bg-green-700","5+"]] as [string,string][]).map(([cls, label]) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${cls} border border-slate-200`} />
            <span>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-blue-100 ring-2 ring-blue-500 ring-inset" />
          <span>Yours</span>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-col lg:flex-row gap-3 items-start">

        {/* Calendar — scrollable on mobile */}
        <div className="flex-1 min-w-0 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <div className="bg-white min-w-[540px]" style={{ userSelect: "none" }}>

            {/* Header row */}
            <div className="grid" style={{ gridTemplateColumns: "44px repeat(7, 1fr)" }}>
              <div className="border-b border-r border-slate-200 bg-slate-50" />
              {weekDays.map((day, i) => {
                const isToday = formatDate(day) === today;
                return (
                  <div key={i} className={`border-b border-r last:border-r-0 border-slate-200 py-2 text-center ${isToday ? "bg-blue-50" : "bg-slate-50"}`}>
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-blue-500" : "text-slate-400"}`}>
                      {WEEKDAY_LABELS[i]}
                    </div>
                    <div className={`text-sm font-bold mt-0.5 ${isToday ? "text-blue-600" : "text-slate-700"}`}>
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Time rows */}
            {HOURS.map((hour) => (
              <div key={hour} className="grid" style={{ gridTemplateColumns: "44px repeat(7, 1fr)" }}>
                <div className="border-b border-r border-slate-100 bg-slate-50 flex items-center justify-end pr-1.5">
                  <span className="text-[10px] text-slate-400 font-mono">{String(hour).padStart(2,"0")}:00</span>
                </div>
                {weekDays.map((day, di) => {
                  const key = slotKey(day, hour);
                  const usersInSlot = allSlots.get(key) ?? new Set<string>();
                  const count  = usersInSlot.size;
                  const isMine = mySlots.has(key);
                  const isBest = bestSlot?.key === key;

                  let cellClass = "";
                  if (viewUser) {
                    const has = usersInSlot.has(viewUser);
                    cellClass = has
                      ? viewUser === currentUser ? "bg-blue-200 ring-2 ring-blue-500 ring-inset" : "bg-purple-200"
                      : "bg-slate-50";
                  } else {
                    cellClass = heatmapColor(count, isMine);
                  }

                  return (
                    <div key={di}
                      title={count > 0 ? `${count} available: ${Array.from(usersInSlot).join(", ")}` : "No one"}
                      className={`border-b border-r last:border-r-0 border-slate-100 h-9 cursor-pointer transition-colors relative
                        ${cellClass}
                        ${formatDate(day) === today ? "border-l border-l-blue-200" : ""}
                        ${isBest && !viewUser ? "ring-1 ring-yellow-400 ring-inset" : ""}
                      `}
                      onMouseDown={() => handleMouseDown(key)}
                      onMouseEnter={() => handleMouseEnter(key)}
                      onTouchEnd={(e) => handleTouchEnd(e, key)}
                    >
                      {isBest && !viewUser && count > 0 && (
                        <span className="absolute top-0 right-0 text-[8px] leading-none bg-yellow-400 text-yellow-900 px-0.5 rounded-bl font-bold">★</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Notes panel ── */}
        <div className="w-full lg:w-64 lg:shrink-0">
          <div className="bg-white/95 rounded-2xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Notes for this week</h2>

            {editingComment ? (
              <div>
                <textarea
                  value={draftComment}
                  onChange={e => setDraftComment(e.target.value)}
                  placeholder="e.g. Free after work Mon–Thu, prefer Sunday on weekends"
                  rows={4}
                  maxLength={300}
                  autoFocus
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-slate-50"
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveComment}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl py-2 transition-colors">
                    Save
                  </button>
                  <button onClick={() => { setEditingComment(false); setDraftComment(myComment); }}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold rounded-xl py-2 transition-colors">
                    Cancel
                  </button>
                </div>
                {myComment && (
                  <button onClick={deleteComment}
                    className="mt-2 w-full text-xs text-red-400 hover:text-red-600 py-1 transition-colors">
                    Delete note
                  </button>
                )}
              </div>
            ) : (
              <div>
                {myComment ? (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-blue-700">{currentUser}</span>
                      <button
                        onClick={() => { setEditingComment(true); setDraftComment(myComment); }}
                        className="text-xs text-blue-400 hover:text-blue-600 font-medium">
                        Edit
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{myComment}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingComment(true); setDraftComment(""); }}
                    className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-400 text-sm font-medium rounded-xl py-3 transition-colors active:bg-blue-50">
                    <span className="text-lg leading-none">+</span> Add your note
                  </button>
                )}

                {comments.filter(c => c.user_name !== currentUser).length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Others</div>
                    {comments.filter(c => c.user_name !== currentUser).map(c => (
                      <div key={c.user_name} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                        <div className="text-xs font-bold text-slate-600 mb-1">{c.user_name}</div>
                        <p className="text-sm text-slate-500 leading-relaxed whitespace-pre-wrap">{c.comment}</p>
                      </div>
                    ))}
                  </div>
                )}

                {comments.length === 0 && (
                  <p className="text-xs text-slate-400 text-center mt-2">No notes yet for this week</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-3 text-center bg-white/80 rounded-full py-1.5 px-4 w-fit mx-auto shadow-sm">
        Tap or drag to toggle · Hover to see who&apos;s available
      </p>
    </div>
  );
}

// ─── Best Slot Banner ─────────────────────────────────────────────────────────

function BestSlotBanner({ slot, count }: { slot: string; count: number }) {
  const { date, hour } = parseSlotKey(slot);
  const dateObj = new Date(`${date}T00:00:00`);
  const dayLabel = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="mb-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-amber-400 text-base shrink-0">★</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-900 truncate">
            {dayLabel}, {String(hour).padStart(2,"0")}:00–{String(hour+1).padStart(2,"0")}:00
          </p>
          <p className="text-xs text-amber-600 mt-0.5">
            {count} {count === 1 ? "person" : "people"} available
          </p>
        </div>
      </div>
      <button
        onClick={() => downloadICS(slot)}
        className="shrink-0 flex items-center gap-1.5 bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-amber-900 font-semibold text-xs px-3 py-2 rounded-xl transition-colors"
      >
        ⬇ .ics
      </button>
    </div>
  );
}
