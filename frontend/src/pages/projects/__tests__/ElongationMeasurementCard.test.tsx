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

it('guarda el valor manual y lo aprueba en una sola acción', () => {
  const onPatch = show();
  fireEvent.change(screen.getByLabelText('Medida (cm)'), { target: { value: '4,8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(onPatch).toHaveBeenCalledWith({
    measured_elongation: '4,8',
    match_method: 'manual',
    review_status: 'approved',
  });
});

it('no confunde 3,7 con 3.700 y permite aprobar fuera de rango con observación', () => {
  const onPatch = show();
  fireEvent.change(screen.getByLabelText('Medida (cm)'), { target: { value: '3.7' } });
  expect(
    screen.getByText(/La precisión no cambia el valor: 3,7 y 3,700 son iguales/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aprobar con observación' })).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Observación obligatoria para aprobar'), {
    target: { value: 'Medida comprobada en obra.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar con observación' }));
  expect(onPatch).toHaveBeenCalledWith({
    measured_elongation: '3.7',
    match_method: 'manual',
    override_reason: 'Medida comprobada en obra.',
    review_status: 'approved',
  });
});

it('muestra valores almacenados con la precisión legible para el usuario', () => {
  show(measurement({ measured_elongation: '3.700' }));
  expect(screen.getByLabelText('Medida (cm)')).toHaveValue('3.7');
});
