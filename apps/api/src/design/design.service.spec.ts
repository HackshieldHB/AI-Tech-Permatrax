import { DesignService } from './design.service';

describe('DesignService update', () => {
  const mockDesignId = 'test-id';
  const mockUpdateInput = {
    geometry: { type: 'FeatureCollection', features: [] },
    sketchTopology: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    },
  };

  const prismaService = {
    networkDesign: {
      update: jest.fn(),
    },
  } as unknown as any;

  const service = new DesignService(prismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(service as any, 'assertDesignMutable').mockResolvedValue(undefined);
  });

  it('should successfully update baseTopology and sketchTopology with GeoJSON payloads', async () => {
    const mockUpdatedDesign = { id: mockDesignId, ...mockUpdateInput };
    prismaService.networkDesign.update.mockResolvedValue(mockUpdatedDesign);

    const result = await service.update(mockDesignId, mockUpdateInput as any);

    expect(prismaService.networkDesign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockDesignId },
        data: expect.objectContaining({
          baseTopology: mockUpdateInput.geometry,
          sketchTopology: mockUpdateInput.sketchTopology,
        }),
      }),
    );
    expect(result).toEqual(mockUpdatedDesign);
  });
});
