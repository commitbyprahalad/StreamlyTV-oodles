import React from 'react';

export const LOGO = 'images/streamly-logo.png';

// Top bar with the Streamly logo; children render on the right.
export default function Header(props) {
  return (
    <div className="app-header">
      <img src={LOGO} alt="Streamly" className="app-header-logo" />
      <div className="app-header-right">{props.children}</div>
    </div>
  );
}
