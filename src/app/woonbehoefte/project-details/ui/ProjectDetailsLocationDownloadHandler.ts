import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { WoonbehoefteCaseRepository } from '../../cases/WoonbehoefteCaseRepository';
import { buildProjectGeoJson } from '../location/buildProjectGeoJson';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';

const WOONBEHOEFTE_VIEW_CHECK = { resource: 'woonbehoefte', action: 'view' } as const;

/** Alleen de tekens die een OF-kenmerk zelf al gebruikt; een verrassend teken in de header wordt zo nooit doorgegeven. */
function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Handles `GET /woonbehoefte/cases/{caseReference}/project-details/location.geojson`. Bouwt de
 * FeatureCollection on demand uit de al opgeslagen, al gecontroleerde polygon; vertrouwt geen door de
 * browser meegegeven geometrie, naam of Open Zaak-URL. Een handmatige polygon heeft voorrang boven de
 * bronpolygon, dezelfde regel als op de detailpagina.
 */
export class ProjectDetailsLocationDownloadHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly store: ProjectDetailsStore,
  ) { }

  async handleRequest(identity: EmployeeIdentity, caseReference: string | undefined): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, WOONBEHOEFTE_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const woonbehoefteCase = await this.caseRepository.getCase(caseReference);
    if (!woonbehoefteCase) {
      return Response.error(404);
    }

    const workVersion = await this.store.getWorkVersion(caseReference);
    const polygon = workVersion?.manualLocationPolygon ?? workVersion?.sourceLocationPolygon;
    if (!workVersion || !polygon) {
      return Response.error(404);
    }

    const geoJson = buildProjectGeoJson(polygon);
    const filename = sanitizeFilenameSegment(caseReference);

    return {
      statusCode: 200,
      isBase64Encoded: false,
      body: JSON.stringify(geoJson),
      headers: {
        // .json opent standaard makkelijker dan .geojson, zonder dat de inhoud (een FeatureCollection) verandert.
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}.json"`,
        'Cache-Control': 'private, no-store',
      },
    };
  }
}
