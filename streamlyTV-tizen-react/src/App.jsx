import React, { useEffect, useState } from 'react';
import { useRoute } from './core/nav';
import { PopupHost } from './core/popup';
import { LoadingHost } from './core/loading';
import Splash from './screens/Splash';
import Guide from './screens/Guide';
import Login from './screens/Login';
import DeviceLimit from './screens/DeviceLimit';
import PersonalDevice from './screens/PersonalDevice';
import HotelRoom from './screens/HotelRoom';
import Subscription from './screens/Subscription';
import Epg from './screens/epg/Epg';
import Settings from './screens/settings/Settings';

const SCREENS = {
  splash: Splash,
  guide: Guide,
  login: Login,
  device: DeviceLimit,
  personalDevice: PersonalDevice,
  hotelRoom: HotelRoom,
  subscription: Subscription,
  epg: Epg,
  settings: Settings,
};

// The UI is designed for a 1920x1080 TV screen; anything else (720p panel,
// emulator, desktop browser) gets the same layout scaled to fit.
function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(function () {
    function update() {
      const w = window.innerWidth || 1920;
      const h = window.innerHeight || 1080;
      setScale(Math.min(w / 1920, h / 1080));
    }
    update();
    window.addEventListener('resize', update);
    return function () {
      window.removeEventListener('resize', update);
    };
  }, []);
  return scale;
}

export default function App() {
  const route = useRoute();
  const scale = useStageScale();
  const Screen = SCREENS[route.screen] || Splash;
  const stageStyle = scale === 1 ? undefined : {
    transform: 'scale(' + scale + ')',
    WebkitTransform: 'scale(' + scale + ')',
  };

  return (
    <div className="stage" style={stageStyle}>
      <Screen key={route.id} params={route.params} />
      <LoadingHost />
      <PopupHost />
    </div>
  );
}
