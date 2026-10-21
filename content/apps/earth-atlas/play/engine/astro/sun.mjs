// @ts-check
// Sun position from clock + location, computed on device (NOAA solar calculator equations). No tables, no network.
// Accuracy ~0.1-0.5 degrees, fine for sky colour, shadows, day/night and twilight on any part of Earth at the real time.
const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;

/**
 * @param {number} msUtc milliseconds since epoch (env.now())
 * @param {number} lat degrees, north positive
 * @param {number} lon degrees, east positive
 * @returns {{ elevation: number, azimuth: number, declination: number, eqTime: number, hourAngle: number }} degrees; azimuth clockwise from north; eqTime minutes
 */
export function sunPosition(msUtc, lat, lon) {
  const jd = msUtc / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(rad(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * jc) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const minutesUtc = ((msUtc % 86400000) + 86400000) % 86400000 / 60000;
  const tst = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const phi = rad(lat), dec = rad(declination), ha = rad(hourAngle);
  const cosZen = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)));
  const zenith = deg(Math.acos(cosZen));
  const elevation = 90 - zenith;
  let azimuth;
  const sinZen = Math.sin(rad(zenith));
  if (sinZen < 1e-9 || Math.abs(Math.cos(phi)) < 1e-9) azimuth = lat >= 0 ? 180 : 0;
  else {
    const cosAz = Math.min(1, Math.max(-1, (Math.sin(phi) * Math.cos(rad(zenith)) - Math.sin(dec)) / (Math.cos(phi) * sinZen)));
    const az = deg(Math.acos(cosAz));
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }
  return { elevation, azimuth, declination, eqTime, hourAngle };
}

/** Sky state from solar elevation (degrees). @param {number} elevation */
export function dayState(elevation) {
  if (elevation >= 0) return 'day';
  if (elevation >= -6) return 'civil-twilight';
  if (elevation >= -12) return 'nautical-twilight';
  if (elevation >= -18) return 'astronomical-twilight';
  return 'night';
}
