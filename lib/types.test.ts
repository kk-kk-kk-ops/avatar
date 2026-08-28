import { describe, expect, it } from "vitest";
import {
  circleIntersectsRect,
  clampPosition,
  clampSize,
  findMeetingZoneId,
  rectIntersectsObstacle,
  rectIntersectsRect,
  resolveSpawnPosition,
} from "./types";

describe("clampPosition", () => {
  it("マップ内であればそのままの座標を返す", () => {
    expect(clampPosition(100, 200, 20, 20, 1000, 1000)).toEqual({
      x: 100,
      y: 200,
    });
  });

  it("マップの左上端より外へは出さない", () => {
    expect(clampPosition(-50, -50, 20, 20, 1000, 1000)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("マップの右下端より外へは出さない(幅・高さを考慮する)", () => {
    expect(clampPosition(990, 990, 20, 20, 1000, 1000)).toEqual({
      x: 980,
      y: 980,
    });
  });
});

describe("clampSize", () => {
  it("最小サイズを下回らない", () => {
    const result = clampSize(0, 0, 5, 5, 1000, 1000);
    expect(result.width).toBeGreaterThanOrEqual(40);
    expect(result.height).toBeGreaterThanOrEqual(40);
  });

  it("マップの外へはみ出さないようクランプされる", () => {
    const result = clampSize(950, 950, 500, 500, 1000, 1000);
    expect(result.width).toBeLessThanOrEqual(50);
    expect(result.height).toBeLessThanOrEqual(50);
  });
});

describe("rectIntersectsRect", () => {
  const rect = { x: 100, y: 100, width: 50, height: 50 };

  it("矩形同士が重なっていればtrue", () => {
    expect(rectIntersectsRect(110, 110, 10, 10, rect)).toBe(true);
  });

  it("離れていればfalse", () => {
    expect(rectIntersectsRect(500, 500, 10, 10, rect)).toBe(false);
  });

  it("ちょうど接している(隙間ゼロ)場合は重なりとみなさない", () => {
    // rectの右端(x=150)にちょうど接する矩形(中心160、半幅10→左端150)
    expect(rectIntersectsRect(160, 125, 10, 10, rect)).toBe(false);
  });
});

describe("circleIntersectsRect", () => {
  const rect = { x: 100, y: 100, width: 50, height: 50 };

  it("円が矩形と重なっていればtrue", () => {
    expect(circleIntersectsRect(90, 125, 15, rect)).toBe(true);
  });

  it("円が矩形から十分離れていればfalse", () => {
    expect(circleIntersectsRect(0, 0, 10, rect)).toBe(false);
  });
});

describe("findMeetingZoneId", () => {
  const zones = [
    { id: "zone-a", x: 0, y: 0, width: 100, height: 100, label: "A" },
    { id: "zone-b", x: 200, y: 200, width: 100, height: 100, label: "B" },
  ];

  it("含まれるゾーンのIDを返す", () => {
    expect(findMeetingZoneId(50, 50, zones)).toBe("zone-a");
    expect(findMeetingZoneId(250, 250, zones)).toBe("zone-b");
  });

  it("どのゾーンにも含まれなければnullを返す", () => {
    expect(findMeetingZoneId(150, 150, zones)).toBeNull();
  });
});

describe("resolveSpawnPosition", () => {
  it("障害物と重ならなければそのままの位置を返す", () => {
    const obstacles = [
      { id: "o1", label: "壁", x: 500, y: 500, width: 50, height: 50 },
    ];
    expect(resolveSpawnPosition(0, 0, obstacles)).toEqual({ x: 0, y: 0 });
  });

  it("障害物と重なる場合は上端のすぐ上へ押し出す", () => {
    const obstacles = [
      { id: "o1", label: "壁", x: 90, y: 90, width: 50, height: 50 },
    ];
    const result = resolveSpawnPosition(100, 100, obstacles, 10, 10);
    expect(result.x).toBe(100);
    expect(result.y).toBeLessThan(100);
  });
});

describe("rectIntersectsObstacle", () => {
  const straightObstacle = {
    id: "o1",
    label: "壁",
    x: 100,
    y: 100,
    width: 50,
    height: 50,
  };

  it("rotation未設定はrectIntersectsRectと同じ結果になる(回帰確認)", () => {
    expect(rectIntersectsObstacle(110, 110, 10, 10, straightObstacle)).toBe(
      rectIntersectsRect(110, 110, 10, 10, straightObstacle),
    );
    expect(rectIntersectsObstacle(500, 500, 10, 10, straightObstacle)).toBe(
      rectIntersectsRect(500, 500, 10, 10, straightObstacle),
    );
  });

  it("rotation:0も同様に既存判定と一致する", () => {
    const obstacle = { ...straightObstacle, rotation: 0 };
    expect(rectIntersectsObstacle(110, 110, 10, 10, obstacle)).toBe(true);
    expect(rectIntersectsObstacle(500, 500, 10, 10, obstacle)).toBe(false);
  });

  it("45度回転した壁: 回転前AABBの内側だが菱形の外側にある点はfalse", () => {
    // 中心(125,125)・半幅25の正方形を45度回転させると、対角線方向の
    // 半径は約17.7pxまで縮む。回転前の角(100,100)付近は回転後は
    // 壁の外側になる。
    const obstacle = {
      id: "o1",
      label: "壁",
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      rotation: 45,
    };
    expect(rectIntersectsObstacle(102, 102, 2, 2, obstacle)).toBe(false);
  });

  it("45度回転した壁: 回転後の長軸方向はAABB外でも重なる", () => {
    // 中心(125,125)から真上(x軸方向)へ35px(元のAABBの外)進んだ点は、
    // 45度回転後は壁の対角線方向に伸びた辺と重なる。
    const obstacle = {
      id: "o1",
      label: "壁",
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      rotation: 45,
    };
    expect(rectIntersectsObstacle(125, 90, 3, 3, obstacle)).toBe(true);
  });
});
