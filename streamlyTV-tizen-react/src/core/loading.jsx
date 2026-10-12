/**
 * Full-screen loading overlay. While it is visible all remote keys are
 * swallowed, so OK can't fire the same request twice.
 *   loading.show('Signing out...') / loading.hide() / loading.isVisible()
 */
import React, { useEffect, useState } from 'react';
import { useKeys, PRIORITY } from './keys';

let setLoadingState = null;
let currentText = null;

export const loading = {
  show: function (text) {
    currentText = text || 'Loading...';
    if (setLoadingState) setLoadingState(currentText);
  },
  hide: function () {
    currentText = null;
    if (setLoadingState) setLoadingState(null);
  },
  isVisible: function () {
    return currentText !== null;
  },
};

export function Spinner(props) {
  return <div className={'spinner' + (props.small ? ' spinner-small' : '')} />;
}

export function LoadingHost() {
  const [text, setText] = useState(currentText);

  useEffect(function () {
    setLoadingState = setText;
    return function () {
      setLoadingState = null;
    };
  }, []);

  useKeys(function () {
    /* swallow */
  }, { priority: PRIORITY.LOADING, enabled: text !== null });

  if (text === null) return null;
  return (
    <div className="lm-overlay">
      <div className="lm-box">
        <Spinner />
        <p className="lm-text">{text}</p>
      </div>
    </div>
  );
}
