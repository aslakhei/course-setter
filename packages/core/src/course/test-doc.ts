// A small event for tests: start, three controls, finish; course A uses all, course B shares 32.
import { addControl, addCourse, insertCourseControl } from './commands.ts'
import { type EventDoc, emptyDoc } from './doc.ts'

export function testEvent(): EventDoc {
  let doc = emptyDoc(15000)
  doc = addControl(doc, { id: 's', kind: 'start', position: [0, 0] })
  doc = addControl(doc, { id: 'a', kind: 'control', position: [300, 400] }) // 31
  doc = addControl(doc, { id: 'b', kind: 'control', position: [300, 1000] }) // 32
  doc = addControl(doc, { id: 'c', kind: 'control', position: [900, 1000] }) // 33
  doc = addControl(doc, { id: 'f', kind: 'finish', position: [900, 0] })
  doc = addCourse(doc, { id: 'A', name: 'Long', printScale: 15000 })
  doc = addCourse(doc, { id: 'B', name: 'Short', printScale: 10000 })
  for (const id of ['s', 'a', 'b', 'c', 'f']) doc = insertCourseControl(doc, 'A', id)
  for (const id of ['s', 'b', 'f']) doc = insertCourseControl(doc, 'B', id)
  return doc
}
