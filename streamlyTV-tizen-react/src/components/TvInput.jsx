/**
 * Text field for the TV remote. It stays read-only while focus merely moves
 * over it (so the on-screen keyboard never pops up by accident); the screen
 * sets editing=true when the user presses OK, which un-locks the field and
 * gives it real DOM focus — that is what opens the Tizen IME.
 *
 * Use handleEditingKey() in the screen's key handler while editing.
 */
import React, { useEffect, useRef } from 'react';
import { KEY } from '../lib/keys';

export default function TvInput(props) {
  const ref = useRef(null);
  const editing = !!props.editing;

  useEffect(function () {
    const el = ref.current;
    if (!el) return;
    if (editing) {
      el.readOnly = false;
      el.focus();
      const len = el.value ? el.value.length : 0;
      try {
        el.setSelectionRange(len, len);
      } catch (e) {
        /* password fields on some engines */
      }
    } else {
      el.readOnly = true;
      if (document.activeElement === el) el.blur();
    }
  }, [editing]);

  return (
    <input
      ref={ref}
      id={props.id}
      className={'tv-input' + (props.focused ? ' focused' : '') + (editing ? ' editing' : '') +
        (props.className ? ' ' + props.className : '')}
      type={props.type || 'text'}
      value={props.value}
      placeholder={props.placeholder}
      readOnly={!editing}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={props.maxLength}
      onChange={function (e) {
        props.onChange(e.target.value);
      }}
      onBlur={function () {
        if (editing && props.onStopEditing) props.onStopEditing();
      }}
      onClick={props.onClick}
    />
  );
}

/**
 * Keys while a field is being edited:
 *  - LEFT/RIGHT move the caret (native)
 *  - OK / Done / Back / Cancel close the keyboard and keep focus on the field
 *  - UP/DOWN close the keyboard and then navigate normally
 * Returns 'native', 'handled' or 'navigate'.
 */
export function handleEditingKey(code, stopEditing) {
  if (code === KEY.LEFT || code === KEY.RIGHT) return 'native';
  if (code === KEY.ENTER || code === KEY.IME_DONE || code === KEY.BACK || code === KEY.IME_CANCEL || code === KEY.EXIT) {
    stopEditing();
    return 'handled';
  }
  if (code === KEY.UP || code === KEY.DOWN) {
    stopEditing();
    return 'navigate';
  }
  return 'native'; // typing, backspace, etc.
}
