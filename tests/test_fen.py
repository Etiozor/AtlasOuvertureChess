"""Normalisation de la clé FEN (critères d'acceptation 3 et 4)."""
import chess

from atlas.chess_utils import truncate_fen


def _key_after(moves_san):
    b = chess.Board()
    for san in moves_san:
        b.push_san(san)
    return truncate_fen(b)


def test_truncation_ignores_move_counters():
    """Deux positions identiques atteintes par des chemins de longueurs
    différentes produisent la même clé (critère 3)."""
    # Même position (départ des cavaliers-rois) atteinte directement vs via un
    # aller-retour qui n'incrémente que les compteurs.
    direct = _key_after(["Nf3", "Nf6"])
    detour = _key_after(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6"])
    assert direct == detour


def test_transposition_converges():
    """1.d4 Cf6 2.c4 e6 3.Cc3 et 1.c4 Cf6 2.Cc3 e6 3.d4 convergent (critère 4)."""
    a = _key_after(["d4", "Nf6", "c4", "e6", "Nc3"])
    b = _key_after(["c4", "Nf6", "Nc3", "e6", "d4"])
    assert a == b


def test_en_passant_legal_only():
    """La case e.p. ne doit apparaître dans la clé que si une capture e.p. est
    réellement légale. Sinon un double-pas anodin scinderait une transposition."""
    # Blancs jouent a2-a4 sans aucun pion noir en b4/… : aucune capture e.p. possible.
    b = chess.Board()
    b.push_san("a4")
    key = truncate_fen(b)
    assert key.split()[3] == "-", f"case e.p. parasite dans la clé : {key}"

    # Contrôle positif : e.p. réellement légale -> la case DOIT figurer.
    b2 = chess.Board()
    for san in ["e4", "a6", "e5", "d5"]:  # ...d7-d5, pion blanc en e5 peut prendre e.p.
        b2.push_san(san)
    assert truncate_fen(b2).split()[3] == "d6"
