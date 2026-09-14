import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MeasurementCard } from '../elongations/ElongationWizard';
import type { ElongationItemV2, ElongationMeasurement } from '@/types/api';

const item = {
  id: 'item',
  label: 'T200',
  classification: 'distributed',
  calculated_elongation: '5.000',
} as ElongationItemV2;

function measurement(overrides: Partial<ElongationMeasurement> = {}): ElongationMeasurement {
  return {
    id: 'measurement',
    ordinal: 1,
    measured_elongation: null,
    minimum_elongation: '4.65000',
    maximum_elongation: '5.35000',
    tolerance_status: 'missing',
    review_status: 'pending',
    override_reason: null,
    match_method: null,
    ...overrides,
  } as ElongationMeasurement;
}

function show(
  current: ElongationMeasurement = measurement(),
  canEdit = true,
  canApprove = true,
) {
  const onPatch = vi.fn();
  render(
    <MeasurementCard
      item={item}
      measurement={current}
      canEdit={canEdit}
      canApprove={canApprove}
      onPatch={onPatch}
    />,
  );
  return onPatch;
}

it('guarda el valor manual y lo aprueba desde la fila en una sola acción', () => {
  const onPatch = show();
  fireEvent.change(screen.getByLabelText('Medida T200 #1 (cm)'), { target: { value: '4,8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(onPatch).toHaveBeenCalledWith({
    measured_elongation: '4,8',
    match_method: 'manual',
    review_status: 'approved',
  });
});

it('no confunde 3,7 con 3.700 y no muestra un campo de observación', () => {
  const onPatch = show();
  fireEvent.change(screen.getByLabelText('Medida T200 #1 (cm)'), { target: { value: '3.7' } });
  expect(screen.getByText('Se registra automáticamente como excepción al aprobar.')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Observación/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(onPatch).toHaveBeenCalledWith({
    measured_elongation: '3.7',
    match_method: 'manual',
    override_reason: 'Valor fuera de tolerancia confirmado en conciliación rápida.',
    review_status: 'approved',
  });
});

it('muestra valores almacenados con la precisión legible para el usuario', () => {
  show(measurement({ measured_elongation: '3.700' }));
  expect(screen.getByLabelText('Medida T200 #1 (cm)')).toHaveValue('3.7');
});
