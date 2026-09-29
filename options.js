const MAX_PASSENGERS = 6;
const DEFAULTS = { passengers: [{ name: '' }], paymentOption: 'E-Wallet', confirmOnly: false };

const $ = (id) => document.getElementById(id);
const rows = () => [...$('passengers').children];

function updateAddButton() {
  $('add').disabled = rows().length >= MAX_PASSENGERS;
}

function addRow(name = '') {
  if (rows().length >= MAX_PASSENGERS) return;
  const row = $('passenger-row').content.firstElementChild.cloneNode(true);
  row.querySelector('[name=name]').value = name;
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    updateAddButton();
  });
  $('passengers').append(row);
  updateAddButton();
}

function read() {
  const passengers = rows()
    .map((row) => ({ name: row.querySelector('[name=name]').value.replace(/\s+/g, ' ').trim() }))
    .filter((p) => p.name);
  return { passengers, confirmOnly: $('confirmOnly').checked, paymentOption: $('paymentOption').value.trim() };
}

async function save() {
  const profile = read();
  const error = profile.passengers.length ? '' : 'Add at least one passenger.';
  $('status').textContent = error || 'Saved.';
  $('status').className = error ? 'error' : '';
  if (!error) await chrome.storage.local.set({ profile });
}

async function load() {
  const { profile } = await chrome.storage.local.get('profile');
  const settings = { ...DEFAULTS, ...profile };
  const passengers = settings.passengers.length ? settings.passengers : DEFAULTS.passengers;
  passengers.forEach((p) => addRow(p.name));
  $('paymentOption').value = settings.paymentOption;
  $('confirmOnly').checked = !!settings.confirmOnly;
}

$('add').addEventListener('click', () => addRow());
$('save').addEventListener('click', save);
load();
