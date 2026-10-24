import { describe, it, expect } from 'vitest';
import { clientNumbers, fullAddress, techsOf } from './site-info';

describe('site info', () => {
  it('reads the address, the client numbers and the techs', () => {
    expect(fullAddress({ site_address: '6420 Morganton Road', site_city: 'Fayetteville', site_state: 'NC', site_zip: '28314' })).toBe('6420 Morganton Road, Fayetteville, NC 28314');
    expect(fullAddress({ site_address: '701 West Buford Street', site_city: 'Gaffney', site_state: 'SC', site_zip: '' })).toBe('701 West Buford Street, Gaffney, SC');
    expect(clientNumbers({ external_wo_id: 'LDS-1103', client_reference: '5333202' })).toBe('Ticket LDS-1103 · Site 5333202');
    expect(clientNumbers({ external_wo_id: null, client_reference: null })).toBe('');
    expect(techsOf({ contractor_name: 'Dwayne Cudjoe', contractor_names: ['Dwayne Cudjoe', 'Kendell Newbold'] })).toEqual(['Dwayne Cudjoe', 'Kendell Newbold']);
    expect(techsOf({ contractor_name: '', contractor_names: null })).toEqual([]);
  });
});
