"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ConfirmDialog() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="stitch-soft-button">
          Cancelar registro
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="stitch-pop-in">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar ação crítica</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação será registrada na auditoria e poderá afetar indicadores do CD.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
