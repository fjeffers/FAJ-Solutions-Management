'use client';
import { useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder, WorkOrder } from '@/lib/types';

const DAY_MS = 86400000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // back up to Sunday
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getTime() + i * DAY_MS));
  return days;
}

export default function SchedulingView({
  workOrders,
  contractors,
  onUpdateWO,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  onUpdateWO: (id: string, patch: Partial<WorkOrder>) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const activeWOs = useMemo(
    () => workOrders.filter((w) => w.wo_status !== 'Paid' && !w.archived_at),
    [workOrders],
  );

  const pool = useMemo(
    () => activeWOs.filter((w) => !w.scheduled_date),
    [activeWOs],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, EnrichedWorkOrder[]>();
    for (const w of activeWOs) {
      if (!w.scheduled_date) continue;
      const key = w.scheduled_date.split('T')[0];
      map.set(key, [...(map.get(key) ?? []), w]);
    }
    return map;
  }, [activeWOs]);

  const contractorLoad = useMemo(() => {
    return contractors.map((c) => ({
      contractor: c,
      count: activeWOs.filter((w) => w.contractor_name === c.name).length,
    }));
  }, [contractors, activeWOs]);

  const days = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const goMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const handleDragEnd = (result: DropResult) => {
    const { destination, draggableId } = result;
    if (!destination) return;
    const woId = draggableId;

    if (destination.droppableId.startsWith('day:')) {
      const date = destination.droppableId.slice(4);
      onUpdateWO(woId, { scheduled_date: date });
    } else if (destination.droppableId === 'pool') {
      onUpdateWO(woId, { scheduled_date: null });
    } else if (destination.droppableId.startsWith('contractor:')) {
      const name = destination.droppableId.slice('contractor:'.length);
      const wo = activeWOs.find((w) => w.id === woId);
      const patch: Partial<WorkOrder> = { contractor_name: name };
      if (wo?.wo_status === 'Open') patch.wo_status = 'Assigned';
      onUpdateWO(woId, patch);
    }
  };

  return (
    <div className="view-inner" style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>SCHEDULING</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Scheduling Dashboard</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>Drag jobs onto a date or a contractor to assign them</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" style={{ padding: 8 }} onClick={() => goMonth(-1)}><ChevronLeft size={16} /></button>
          <div style={{ fontWeight: 700, fontSize: 15, minWidth: 140, textAlign: 'center' }}>
            {new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </div>
          <button className="btn btn-ghost" style={{ padding: 8 }} onClick={() => goMonth(1)}><ChevronRight size={16} /></button>
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 20 }}>
          {/* Calendar grid */}
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, textTransform: 'uppercase' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {days.map((d) => {
                const key = ymd(d);
                const inMonth = d.getMonth() === month;
                const isToday = key === ymd(now);
                const items = byDay.get(key) ?? [];
                return (
                  <Droppable droppableId={`day:${key}`} key={key}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{
                          minHeight: 96, borderRadius: 8, padding: 6,
                          background: snapshot.isDraggingOver ? 'rgba(13,115,119,0.08)' : inMonth ? '#fff' : '#fafafa',
                          border: isToday ? '1.5px solid var(--teal)' : '1px solid #eee',
                          opacity: inMonth ? 1 : 0.5,
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--teal)' : '#888', marginBottom: 4 }}>
                          {d.getDate()}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {items.map((w, idx) => (
                            <Draggable draggableId={w.id} index={idx} key={w.id}>
                              {(dragProvided) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  style={{
                                    padding: '4px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                                    background: 'rgba(13,115,119,0.1)', color: 'var(--teal)', cursor: 'grab',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    ...dragProvided.draggableProps.style,
                                  }}
                                  title={`WO#${w.wo_number} — ${w.contractor_name}`}
                                >
                                  #{w.wo_number} {w.contractor_name}
                                </div>
                              )}
                            </Draggable>
                          ))}
                        </div>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </div>

          {/* Sidebar: unscheduled pool + contractor load */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="glass card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
                <Inbox size={14} color="var(--teal)" /> Unscheduled ({pool.length})
              </div>
              <Droppable droppableId="pool">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60, maxHeight: 400, overflowY: 'auto',
                      background: snapshot.isDraggingOver ? 'rgba(13,115,119,0.06)' : 'transparent', borderRadius: 8, padding: 4,
                    }}
                  >
                    {pool.length === 0 && (
                      <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: '12px 0' }}>All jobs scheduled</div>
                    )}
                    {pool.map((w, idx) => (
                      <Draggable draggableId={w.id} index={idx} key={w.id}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            style={{
                              padding: '8px 10px', borderRadius: 8, background: '#fff',
                              border: '1px solid #eee', cursor: 'grab',
                              ...dragProvided.draggableProps.style,
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>#{w.wo_number}</div>
                            <div style={{ fontSize: 11, color: '#555' }}>{w.title || w.contractor_name}</div>
                            <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{fmtMoney(Number(w.total_amount))}</div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>

            <div className="glass card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Contractors</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {contractorLoad.map(({ contractor, count }) => (
                  <Droppable droppableId={`contractor:${contractor.name}`} key={contractor.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 10px', borderRadius: 8,
                          background: snapshot.isDraggingOver ? 'rgba(13,115,119,0.1)' : '#fafafa',
                          border: snapshot.isDraggingOver ? '1px dashed var(--teal)' : '1px solid #f0f0f0',
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{contractor.name}</span>
                        <span style={{ fontSize: 11, color: '#999', fontWeight: 700 }}>{count}</span>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}
