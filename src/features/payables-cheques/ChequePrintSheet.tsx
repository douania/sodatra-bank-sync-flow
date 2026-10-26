import React from 'react';
import { chequePrintCss, isLayoutFailure, layoutCheque, PRINT_ROOT_CLASS, type ChequeContentFields } from './chequeLayout';

// Calque des seuls champs à remplir, positionnés en millimètres sur la formule
// préimprimée. Aucun fond de formule, aucune signature reproduite. Le logiciel
// ne règle pas le pilote : l'échelle 100 % et le bac relèvent de la procédure
// d'impression validée avec le profil.

interface ChequePrintSheetProps {
  fields: ChequeContentFields;
  layout: unknown;
  mode: 'preview' | 'print';
}

export function ChequePrintSheet({ fields, layout, mode }: ChequePrintSheetProps) {
  const result = layoutCheque(fields, layout);
  if (isLayoutFailure(result)) {
    return (
      <div role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">
        Impression impossible : {result.reason === 'PAYABLES_PRINT_LAYOUT_OVERFLOW'
          ? 'le texte dépasse la zone imprimable.'
          : 'le profil d’impression est incomplet ou incohérent.'}
      </div>
    );
  }
  return (
    <>
      {mode === 'print' && <style>{chequePrintCss(result.page.width_mm, result.page.height_mm)}</style>}
      <div
        className={mode === 'print' ? PRINT_ROOT_CLASS : 'border border-dashed border-muted-foreground bg-white'}
        data-testid="cheque-sheet"
        style={{
          position: 'relative',
          width: `${result.page.width_mm}mm`,
          height: `${result.page.height_mm}mm`,
          fontFamily: result.font.family,
          fontSize: `${result.font.size_pt}pt`,
          color: '#000',
        }}
      >
        {result.items.map((item) => (
          <span
            key={item.key}
            data-field={item.key}
            style={{ position: 'absolute', left: `${item.x_mm}mm`, top: `${item.y_mm}mm`, whiteSpace: 'nowrap' }}
          >
            {item.text}
          </span>
        ))}
      </div>
    </>
  );
}
