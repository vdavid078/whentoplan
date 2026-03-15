"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, type Availability } from "@/lib/supabase";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday as start
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
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function slotKey(date: Date, hour: number): string {
  return `${formatDate(date)}_${String(hour).padStart(2, "0")}`;
}

function parseSlotKey(key: string): { date: string; hour: number } {
  const [date, hourStr] = key.split("_");
  return { date, hour: parseInt(hourStr, 10) };
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatmapColor(count: number, maxCount: number, isCurrentUser: boolean) {
  const base =
    count === 0
      ? "bg-slate-100"
      : count === 1
      ? "bg-green-100"
      : count === 2
      ? "bg-green-300"
      : count < 5
      ? "bg-green-500"
      : "bg-green-700";

  const outline = isCurrentUser ? "ring-2 ring-blue-500 ring-inset" : "";
  return `${base} ${outline}`;
}

function generateICS(slot: string): string {
  const { date, hour } = parseSlotKey(slot);
  const [year, month, day] = date.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dtStart = `${year}${pad(month)}${pad(day)}T${pad(hour)}0000`;
  const dtEnd = `${year}${pad(month)}${pad(day)}T${pad(hour + 1)}0000`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PapicinosPlanning//EN",
    "BEGIN:VEVENT",
    `UID:papicinos-${slot}@papicinosplanning`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    "SUMMARY:Group Meeting (PapicinosPlanning)",
    "DESCRIPTION:Best available slot from PapicinosPlanning",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(slot: string) {
  const content = generateICS(slot);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `papicinos-${slot}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

type WeekComment = {
  user_name: string;
  week_start: string;
  comment: string;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WeekCalendar({ currentUser }: { currentUser: string }) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  const [allSlots, setAllSlots] = useState<Map<string, Set<string>>>(new Map());
  const [mySlots, setMySlots] = useState<Set<string>>(new Set());
  const [viewUser, setViewUser] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<string[]>([]);

  // Comments
  const [comments, setComments] = useState<WeekComment[]>([]);
  const [myComment, setMyComment] = useState("");
  const [editingComment, setEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState("");

  // Drag state
  const dragging = useRef(false);
  const dragMode = useRef<"add" | "remove">("add");
  const dragStartSlot = useRef<string | null>(null);
  const pendingToggle = useRef<Set<string>>(new Set());

  const weekKey = formatDate(weekStart);

  // Load availabilities
  const loadAll = useCallback(async () => {
    const { data, error } = await supabase
      .from("availabilities")
      .select("user_name, slot_key");
    if (error) { console.error("Load error:", error); return; }

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
    map.forEach((usersInSlot, key) => {
      if (usersInSlot.has(currentUser)) mine.add(key);
    });
    setMySlots(mine);
  }, [currentUser]);

  // Load comments for current week
  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from("week_comments")
      .select("user_name, week_start, comment")
      .eq("week_start", weekKey);
    if (error) { console.error("Comments load error:", error); return; }
    const rows = (data ?? []) as WeekComment[];
    setComments(rows);
    const mine = rows.find((r) => r.user_name === currentUser);
    if (mine) {
      setMyComment(mine.comment);
      setDraftComment(mine.comment);
    } else {
      setMyComment("");
      setDraftComment("");
    }
  }, [currentUser, weekKey]);

  // Clear comment state immediately when week changes
  useEffect(() => {
    setComments([]);
    setMyComment("");
    setDraftComment("");
    setEditingComment(false);
  }, [weekKey]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadComments(); }, [loadComments]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("realtime-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "availabilities" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "week_comments" }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll, loadComments]);

  // ── Slot toggle ──────────────────────────────────────────────────────────

  async function addSlot(key: string) {
    setMySlots((prev) => new Set([...prev, key]));
    setAllSlots((prev) => {
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, new Set());
      next.get(key)!.add(currentUser);
      return next;
    });
    await supabase.from("availabilities").upsert({ user_name: currentUser, slot_key: key });
  }

  async function removeSlot(key: string) {
    setMySlots((prev) => { const next = new Set(prev); next.delete(key); return next; });
    setAllSlots((prev) => { const next = new Map(prev); next.get(key)?.delete(currentUser); return next; });
    await supabase.from("availabilities").delete().eq("user_name", currentUser).eq("slot_key", key);
  }

  // ── Drag ─────────────────────────────────────────────────────────────────

  function handleMouseDown(key: string) {
    dragging.current = true;
    const isSelected = mySlots.has(key);
    dragMode.current = isSelected ? "remove" : "add";
    pendingToggle.current = new Set([key]);
    dragStartSlot.current = key;
    if (dragMode.current === "add") addSlot(key); else removeSlot(key);
  }

  function handleMouseEnter(key: string) {
    if (!dragging.current) return;
    if (pendingToggle.current.has(key)) return;
    pendingToggle.current.add(key);
    if (dragMode.current === "add") addSlot(key); else removeSlot(key);
  }

  function handleMouseUp() {
    dragging.current = false;
    pendingToggle.current.clear();
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
    setMyComment("");
    setDraftComment("");
    setEditingComment(false);
    loadComments();
  }

  // ── Best slot ─────────────────────────────────────────────────────────────

  const bestSlot = (() => {
    let best: string | null = null;
    let bestCount = 0;
    allSlots.forEach((users, key) => {
      if (users.size > bestCount) { bestCount = users.size; best = key; }
    });
    return best ? { key: best, count: bestCount } : null;
  })();

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = formatDate(new Date());

  let maxCount = 1;
  allSlots.forEach((users) => { if (users.size > maxCount) maxCount = users.size; });

  const viewingUser = viewUser;

  return (
    <div className="p-4 max-w-7xl mx-auto" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-sm">
          <button onClick={() => setWeekStart((w) => addDays(w, -7))} className="text-slate-500 hover:text-slate-800 font-bold text-lg px-1">‹</button>
          <span className="text-sm font-medium text-slate-700 min-w-[150px] text-center">
            {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}–{" "}
            {addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <button onClick={() => setWeekStart((w) => addDays(w, 7))} className="text-slate-500 hover:text-slate-800 font-bold text-lg px-1">›</button>
          <button onClick={() => setWeekStart(getWeekStart(new Date()))} className="text-xs text-blue-600 hover:underline ml-1">Today</button>
        </div>

        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-sm flex-wrap">
          <span className="text-xs text-slate-500 font-medium">View:</span>
          <button onClick={() => setViewUser(null)} className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${viewingUser === null ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Everyone</button>
          {allUsers.map((u) => (
            <button key={u} onClick={() => setViewUser(viewingUser === u ? null : u)} className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${viewingUser === u ? "bg-purple-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{u}</button>
          ))}
        </div>
      </div>

      {bestSlot && <BestSlotBanner slot={bestSlot.key} count={bestSlot.count} />}

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 mb-3 text-xs text-slate-500">
        <span>Availability:</span>
        {[["bg-slate-100","0"],["bg-green-100","1"],["bg-green-300","2"],["bg-green-500","3–4"],["bg-green-700","5+"]].map(([cls, label]) => (
          <div key={label} className="flex items-center gap-1"><div className={`w-4 h-4 rounded ${cls} border border-slate-200`} /><span>{label}</span></div>
        ))}
        <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-blue-100 ring-2 ring-blue-500 ring-inset border border-slate-200" /><span>Your slot</span></div>
      </div>

      {/* ── Main layout: calendar + comments side by side ── */}
      <div className="flex gap-4 items-start">
        {/* Calendar */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-select" style={{ userSelect: "none" }}>
          <div className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}>
            <div className="border-b border-r border-slate-200 bg-slate-50" />
            {weekDays.map((day, i) => {
              const isToday = formatDate(day) === today;
              return (
                <div key={i} className={`border-b border-r last:border-r-0 border-slate-200 py-2 text-center ${isToday ? "bg-blue-50" : "bg-slate-50"}`}>
                  <div className={`text-xs font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{WEEKDAY_LABELS[i]}</div>
                  <div className={`text-sm font-bold ${isToday ? "text-blue-700" : "text-slate-700"}`}>{day.getDate()}</div>
                </div>
              );
            })}
          </div>
          {HOURS.map((hour) => (
            <div key={hour} className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}>
              <div className="border-b border-r border-slate-100 bg-slate-50 flex items-center justify-end pr-2">
                <span className="text-xs text-slate-400 font-mono">{String(hour).padStart(2, "0")}:00</span>
              </div>
              {weekDays.map((day, di) => {
                const key = slotKey(day, hour);
                const usersInSlot = allSlots.get(key) ?? new Set<string>();
                const count = usersInSlot.size;
                const isMine = mySlots.has(key);
                const isBest = bestSlot?.key === key;

                let cellClass = "";
                if (viewingUser) {
                  const userHasSlot = usersInSlot.has(viewingUser);
                  cellClass = userHasSlot ? (viewingUser === currentUser ? "bg-blue-200 ring-2 ring-blue-500 ring-inset" : "bg-purple-200") : "bg-slate-50";
                } else {
                  cellClass = heatmapColor(count, maxCount, isMine);
                }

                return (
                  <div
                    key={di}
                    title={count > 0 ? `${count} available: ${Array.from(usersInSlot).join(", ")}` : "No one available"}
                    className={`border-b border-r last:border-r-0 border-slate-100 h-8 cursor-pointer transition-all relative ${cellClass} ${formatDate(day) === today ? "border-l border-l-blue-200" : ""} ${isBest && !viewingUser ? "ring-1 ring-yellow-400" : ""}`}
                    onMouseDown={() => handleMouseDown(key)}
                    onMouseEnter={() => handleMouseEnter(key)}
                  >
                    {isBest && !viewingUser && count > 0 && (
                      <span className="absolute top-0 right-0 text-[9px] leading-none bg-yellow-400 text-yellow-900 px-0.5 rounded-bl font-bold">★</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Comments panel ── */}
        <div className="w-64 shrink-0 flex flex-col gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Notes for this week</h2>

            {/* My comment */}
            {editingComment ? (
              <div className="mb-3">
                <textarea
                  value={draftComment}
                  onChange={(e) => setDraftComment(e.target.value)}
                  placeholder="e.g. Free after work Mon–Thu, prefer Sunday on weekends"
                  rows={4}
                  maxLength={300}
                  autoFocus
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={saveComment} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg py-1.5 transition-colors">Save</button>
                  <button onClick={() => { setEditingComment(false); setDraftComment(myComment); }} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-lg py-1.5 transition-colors">Cancel</button>
                </div>
                {myComment && (
                  <button onClick={deleteComment} className="mt-1 w-full text-xs text-red-400 hover:text-red-600 transition-colors">Delete my note</button>
                )}
              </div>
            ) : (
              <div className="mb-3">
                {myComment ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-blue-700">{currentUser}</span>
                      <button onClick={() => { setEditingComment(true); setDraftComment(myComment); }} className="text-xs text-blue-400 hover:text-blue-600">Edit</button>
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap">{myComment}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingComment(true); setDraftComment(""); }}
                    className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 text-slate-400 text-xs font-medium rounded-lg py-2.5 transition-colors"
                  >
                    <span className="text-base leading-none">+</span> Add your note
                  </button>
                )}
              </div>
            )}

            {/* Other people's comments */}
            {comments.filter((c) => c.user_name !== currentUser).length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wide">Others</div>
                {comments
                  .filter((c) => c.user_name !== currentUser)
                  .map((c) => (
                    <div key={c.user_name} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                      <div className="text-xs font-semibold text-slate-600 mb-1">{c.user_name}</div>
                      <p className="text-xs text-slate-500 whitespace-pre-wrap">{c.comment}</p>
                    </div>
                  ))}
              </div>
            )}

            {comments.length === 0 && !editingComment && (
              <p className="text-xs text-slate-400 text-center mt-1">No notes yet for this week</p>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-3 text-center">
        Click or drag to toggle your availability · Hover a slot to see who&apos;s available
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
    <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-yellow-500 text-lg">★</span>
        <div>
          <p className="text-sm font-semibold text-yellow-900">
            Best slot — {dayLabel}, {String(hour).padStart(2, "0")}:00–{String(hour + 1).padStart(2, "0")}:00
          </p>
          <p className="text-xs text-yellow-700">{count} {count === 1 ? "person" : "people"} available</p>
        </div>
      </div>
      <button onClick={() => downloadICS(slot)} className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors">
        <span>⬇</span> Export .ics
      </button>
    </div>
  );
}
