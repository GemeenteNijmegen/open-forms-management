import { WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';
import { ProjectDetailsWorkVersion } from '../../project-details/domain/ProjectDetails';
import { ProjectDetailsStore } from '../../project-details/persistence/ProjectDetailsStore';

const CONCURRENCY = 4;

/**
 * GetItem per dossier op de Projectdetails-tabel, met dezelfde kleine vaste concurrency als
 * fetchWoonbehoefteRawFormFields. Anders dan die functie vangt dit een leesfout bewust niet zelf op: die moet
 * het hele rapport laten mislukken via het bestaande foutpad in WoonbehoefteExcelWorkerRunner, in plaats van
 * stilzwijgend een Excel-bestand met ontbrekende Mijn Aansluiting-data op te leveren.
 */
export async function fetchWoonbehoefteReportProjectDetails(
  store: ProjectDetailsStore, entries: WoonbehoefteCaseWithSource[],
): Promise<Map<string, ProjectDetailsWorkVersion>> {
  const result = new Map<string, ProjectDetailsWorkVersion>();
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      const { caseReference } = entries[index].woonbehoefteCase;
      const workVersion = await store.getWorkVersion(caseReference);
      if (workVersion) {
        result.set(caseReference, workVersion);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}
