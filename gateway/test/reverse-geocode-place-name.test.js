const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectReverseGeocodePlaceName,
} = require('../src/geolocate/google');

function component(longName, ...types) {
  return { long_name: longName, types };
}

test('place label combines locality with a nearby road', () => {
  const label = selectReverseGeocodePlaceName([
    {
      types: ['route'],
      address_components: [
        component('Royal Road', 'route'),
        component('Grand Baie', 'locality'),
      ],
    },
  ]);
  assert.equal(label, 'Grand Baie · near Royal Road');
});

test('place label prefers a returned landmark without claiming wearer is there', () => {
  const label = selectReverseGeocodePlaceName([
    {
      types: ['route'],
      address_components: [
        component('B13', 'route'),
        component('Grand Baie', 'locality'),
      ],
    },
    {
      types: ['point_of_interest', 'establishment'],
      address_components: [
        component('Super U Grand Baie', 'establishment', 'point_of_interest'),
        component('Grand Baie', 'locality'),
      ],
    },
  ]);
  assert.equal(label, 'Grand Baie · near Super U Grand Baie');
});

test('place label uses a distinct neighborhood before the road', () => {
  const label = selectReverseGeocodePlaceName([
    {
      types: ['street_address'],
      address_components: [
        component('B11', 'route'),
        component('Lower Vale', 'neighborhood'),
        component('Grand Baie', 'locality'),
      ],
    },
  ]);
  assert.equal(label, 'Grand Baie · near Lower Vale');
});

test('place label falls back cleanly when no useful nearby detail exists', () => {
  const label = selectReverseGeocodePlaceName([
    {
      types: ['locality'],
      address_components: [component('Grand Baie', 'locality')],
    },
  ]);
  assert.equal(label, 'Grand Baie');
});

test('place label never repeats the same area as nearby context', () => {
  const label = selectReverseGeocodePlaceName([
    {
      types: ['locality', 'route'],
      address_components: [
        component('Grand Baie', 'locality'),
        component('grand baie', 'route'),
      ],
    },
  ]);
  assert.equal(label, 'Grand Baie');
});
